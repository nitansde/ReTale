import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'
import { registerNovelDatabaseFixture } from '@/tests/helpers/novel-db'
import { previewFutureJumpContext } from '@/lib/server/future-jump-service'
import { applyPresetCompatCreativeRuntime } from '@/lib/preset-compat/apply-runtime'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createDatabaseAccess, runWithDatabaseAccessScope, type DatabaseAccess } from '@/lib/server/database-access'
import { compressGeneratedHistory, expandGeneratedHistory, getGeneratedHistory } from '@/lib/server/generated-history'
import { buildGenerationContext } from '@/lib/server/context-builder'
import { prepareGenerationPrompt, buildGenerationPromptPreview } from '@/lib/server/generation-prompt'
import { ConfiguredWritingSkillModelGateway, type ModelGateway, type StructuredGenerationResult } from '@/lib/server/writing-skill-model-gateway'
import { HISTORY_COMPRESSION_BATCH_TOKENS, HISTORY_COMPRESSION_REQUEST_RESERVE } from '@/lib/server/generated-history-batches'
import { estimateTokenCount } from '@/lib/utils'
import { POST as compressionRoute, DELETE as expansionRoute } from '@/app/api/context/compress/route'
import type { GeneratedHistoryScope } from '@/lib/context-compression'

vi.mock('@/lib/server/retrieval-index', () => ({ searchLanceEvidence: vi.fn(async () => ({ matches: [] })) }))
vi.mock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => ({ rewrite: { provider: 'openai-compatible', openAICompatible: { configured: true, baseUrl: 'https://example.test/v1', model: 'test', apiKey: '' }, ollama: {} } }) }))
vi.mock('@/lib/preset-compat/apply-runtime', () => ({ applyPresetCompatCreativeRuntime: vi.fn((input: Record<string, unknown>) => ({ systemPrompt: input.systemPrompt, userPrompt: input.userPrompt, warnings: [], resolvedRuntime: { providerRuntime: { provider: 'openai-compatible', request: {}, config: {} } }, promptAssembly: { user: { segments: [] } } })) }))
vi.mock('@/lib/preset-compat/runtime-integration', () => ({ resolveCreativeRoutePresetCompatMetadata: () => ({ metadata: {}, streamPolicy: { effective: false } }) }))

let dispose: (() => void) | undefined
let cleanup: (() => void) | undefined
let sqlite: DatabaseSync
let db: DatabaseAccess
const original = 'ORIGINAL_DO_NOT_COMPRESS 原著正文始终保持完整。'
const scope: GeneratedHistoryScope = { novelId: 'novel-history', branchId: 'novel-history:main', branchContextNodeId: 'node-3', branchContextInclusion: 'include_selected' }
const texts = ['FIRST_GENERATION ', 'SECOND_GENERATION ', 'LATEST_GENERATION '].map((text) => text.repeat(90))
const gateway = () => ({ getCapabilities: vi.fn(async () => ({ contextWindow: 32000, maxOutputTokens: 4000, supportsStructuredOutput: true, supportsToolCalling: false })), generateStructured: vi.fn<(options: Parameters<ModelGateway['generateStructured']>[0]) => Promise<StructuredGenerationResult<{ summary: string }>>>().mockResolvedValue({ data: { summary: '两人达成同盟，约定在城门汇合。' }, usage: { inputTokens: 100, outputTokens: 20 } }) })

beforeEach(() => {
  const fixture = createTempDatabaseCopy('generated-history')
  cleanup = fixture.cleanup
  sqlite = initializeDatabase(new DatabaseSync(fixture.dbPath))
  db = createDatabaseAccess(sqlite)
  dispose = registerNovelDatabaseFixture(sqlite, [scope.novelId])
  db.execute('INSERT INTO NovelRecord (id, title) VALUES (?, ?)', scope.novelId, 'History')
  db.execute('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)', scope.branchId, scope.novelId, 'main')
  db.execute('INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, rawText, sourceHash) VALUES (?, ?, ?, ?, ?, ?)', 'chapter-1', scope.novelId, scope.branchId, 1, original, 'hash')
  for (let index = 1; index <= 3; index++) {
    db.execute(`INSERT INTO continue_blocks (id, novel_id, branch_id, source_chapter_no, title, user_instruction, selected_text, original_text, latest_text) VALUES (?, ?, ?, 1, ?, '', ?, ?, ?)`, `block-${index}`, scope.novelId, scope.branchId, `Chapter ${index}`, original, original, texts[index - 1])
    db.execute(`INSERT INTO story_timeline_nodes (id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, parent_node_id, continue_block_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`, `node-${index}`, scope.novelId, scope.branchId, index === 1 ? 'rewrite' : 'continue_block', index, `Chapter ${index}`, index > 1 ? `node-${index - 1}` : null, `block-${index}`)
  }
})
afterEach(() => { dispose?.(); sqlite.close(); cleanup?.(); vi.clearAllMocks() })

async function compress(count: number, currentScope = scope, model = gateway()) {
  return compressGeneratedHistory({ scope: currentScope, count, fingerprint: getGeneratedHistory(currentScope, db).preview.fingerprint }, { db, gateway: model as unknown as ModelGateway })
}

async function expand(currentScope = scope) {
  return expandGeneratedHistory({ scope: currentScope, fingerprint: getGeneratedHistory(currentScope, db).preview.fingerprint }, db)
}

describe('generated history compression', () => {
  it.each([8192, 32000, 200000])('budgets every full request including a growing rolling summary for a %s-token model', async (contextWindow) => {
    const chapters = ['开篇', '转折', '后续'].map((label) => `${label}开始\n${'剧情'.repeat(16000)}\n${label}结束`)
    chapters.forEach((content, i) => db.execute('UPDATE continue_blocks SET latest_text = ? WHERE id = ?', content, `block-${i + 1}`))
    const model = gateway()
    model.getCapabilities.mockResolvedValue({ contextWindow, maxOutputTokens: 4000, supportsStructuredOutput: true, supportsToolCalling: false })
    let batchNo = 0
    model.generateStructured.mockImplementation(async () => ({ data: { summary: `第${++batchNo}批累计摘要：${'人物达成约定。'.repeat(Math.min(batchNo * 5, 50))}` }, usage: { inputTokens: 100, outputTokens: 20 } }))
    const result = await compress(3, scope, model)
    const calls = model.generateStructured.mock.calls.map(([request]) => request)
    expect(calls.length).toBeGreaterThan(1)
    for (const [index, request] of calls.entries()) {
      const inputTokens = request.messages.reduce((total, message) => total + estimateTokenCount(message.content), 0)
      expect(inputTokens + HISTORY_COMPRESSION_REQUEST_RESERVE).toBeLessThanOrEqual(HISTORY_COMPRESSION_BATCH_TOKENS)
      expect(inputTokens + request.maxOutputTokens + HISTORY_COMPRESSION_REQUEST_RESERVE).toBeLessThanOrEqual(contextWindow)
      if (index > 0) expect(request.messages[1].content).toContain(`第${index}批累计摘要`)
    }
    if (contextWindow === 200000) {
      expect(calls).toHaveLength(2)
      expect(calls[0].messages[1].content).toContain(chapters[0])
      expect(calls[0].messages[1].content).toContain(chapters[1])
      expect(calls[0].messages[1].content).not.toContain('后续开始')
      expect(calls[1].messages[1].content).toContain(chapters[2])
      expect(calls[1].messages[1].content).not.toContain('开篇开始')
    }
    expect(result.compressedChapters).toBe(3)
    expect(result.summary).toContain(`第${calls.length}批累计摘要`)
    await expand()
    for (const text of chapters) expect(getGeneratedHistory(scope, db).content).toContain(text)
  })

  it('retries context overflow with smaller batches without skipping text or committing an intermediate summary', async () => {
    const longChapter = 'CHAPTER_START\n' + '夜雨'.repeat(45000) + '\nCHAPTER_END'
    db.execute('UPDATE continue_blocks SET latest_text = ? WHERE id = ?', longChapter, 'block-1')
    const model = gateway()
    model.getCapabilities.mockResolvedValue({ contextWindow: 200000, maxOutputTokens: 4000, supportsStructuredOutput: true, supportsToolCalling: false })
    const accepted: string[] = []
    model.generateStructured.mockImplementation(async (request) => {
      expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(0)
      const text = request.messages[1].content.split('新增历史片段（可能是章节的一部分）：\n')[1]
      if (estimateTokenCount(text) > 25000) throw new Error('maximum context length exceeded')
      accepted.push(text.slice('【Chapter 1】\n'.length))
      return { data: { summary: '雨中两人会合。' }, usage: { inputTokens: 100, outputTokens: 20 } }
    })
    await compress(1, scope, model)
    expect(model.generateStructured.mock.calls.length).toBeGreaterThan(accepted.length)
    expect(accepted.join('')).toBe(longChapter)
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(1)
  })

  it('stops shrinking after persistent context errors and preserves the previous summary', async () => {
    const before = await compress(1)
    const model = gateway()
    model.generateStructured.mockRejectedValue(new Error('context_length_exceeded'))
    await expect(compress(2, scope, model)).rejects.toThrow('context_length_exceeded')
    expect(model.generateStructured.mock.calls.length).toBeGreaterThan(1)
    expect(model.generateStructured.mock.calls.length).toBeLessThan(10)
    expect(getGeneratedHistory(scope, db).preview).toEqual(before)
  })

  it('restores the exact full generated history, removes older fallback summaries, and permits recompression', async () => {
    const before = getGeneratedHistory(scope, db)
    await compress(1)
    const compressed = await compress(2)
    const expanded = await expand()
    expect(expanded).toMatchObject({ totalChapters: 3, compressedChapters: 0, summary: null, tokenEstimate: before.preview.tokenEstimate })
    expect(expanded.tokenEstimate).toBeGreaterThan(compressed.tokenEstimate)
    expect(getGeneratedHistory(scope, createDatabaseAccess(sqlite)).content).toBe(before.content)
    await runWithDatabaseAccessScope(db, async () => {
      const prepared = await prepareGenerationPrompt({ ...scope, chapterId: 'chapter-1', sourceText: texts[2], operationType: 'rewrite', userInstruction: '继续' })
      for (const text of texts) expect(prepared.requestPrompts.userPrompt).toContain(text.trim())
      expect(prepared.requestPrompts.userPrompt).toContain(original)
      expect(prepared.requestPrompts.userPrompt).not.toContain('两人达成同盟')
    })
    const model = gateway()
    expect((await compress(1, scope, model)).compressedChapters).toBe(1)
    expect(JSON.stringify(model.generateStructured.mock.calls)).toContain('FIRST_GENERATION')
    expect(db.queryOne<{ latest_text: string }>('SELECT latest_text FROM continue_blocks WHERE id = ?', 'block-1')?.latest_text).toBe(texts[0])
    expect(db.queryOne<{ rawText: string }>('SELECT rawText FROM KnowledgeChapter WHERE id = ?', 'chapter-1')?.rawText).toBe(original)
  })

  it('leaves unrelated generated branches and application settings intact when expanding', async () => {
    db.execute(`INSERT INTO continue_blocks (id, novel_id, branch_id, source_chapter_no, title, user_instruction, selected_text, original_text, latest_text) VALUES ('sibling-block', ?, ?, 1, '另一条故事', '', ?, ?, ?)`, scope.novelId, scope.branchId, original, original, texts[2])
    db.execute(`INSERT INTO story_timeline_nodes (id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, continue_block_id) VALUES ('sibling', ?, ?, 'continue_block', 4, 1, '另一条故事', 'sibling-block')`, scope.novelId, scope.branchId)
    db.execute(`INSERT INTO AppSetting (id, key, value) VALUES ('unrelated', 'UNRELATED_SETTING', 'keep')`)
    const sibling = { ...scope, branchContextNodeId: 'sibling' }
    await compress(1, sibling)
    await compress(2)
    await expand()
    expect(getGeneratedHistory(sibling, db).preview.compressedChapters).toBe(1)
    expect(db.queryOne<{ value: string }>("SELECT value FROM AppSetting WHERE key = 'UNRELATED_SETTING'")?.value).toBe('keep')
  })

  it('rejects stale expansion requests and prevents in-flight compression from overwriting an expansion', async () => {
    const first = await compress(1)
    await compress(2)
    await expect(expandGeneratedHistory({ scope, fingerprint: first.fingerprint }, db)).rejects.toMatchObject({ status: 409 })
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(2)
    const model = gateway()
    model.generateStructured.mockImplementationOnce(async () => {
      await expand()
      return { data: { summary: '摘要' }, usage: { inputTokens: 1, outputTokens: 1 } }
    })
    await expect(compress(3, scope, model)).rejects.toMatchObject({ status: 409 })
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(0)
    expect(getGeneratedHistory(scope, db).content).toContain(texts[0].trim())
  })

  it('replaces exactly the prefix in real writing prompts while preserving original text, later chapters and saved history', async () => {
    const model = gateway()
    const preview = await compress(2, scope, model)
    expect(preview).toMatchObject({ totalChapters: 3, compressedChapters: 2 })
    const request = { ...scope, chapterId: 'chapter-1', selectedText: '', sourceText: texts[2], operationType: 'rewrite' as const, userInstruction: '继续' }
    await runWithDatabaseAccessScope(db, async () => {
      const context = await buildGenerationContext(request)
      const block = context.promptBlocks.find((item) => item.id === 'branch-lineage-full-text')!
      expect(block.content).toContain(original)
      expect(block.content).toContain('两人达成同盟')
      expect(block.content).toContain(texts[2].trim())
      expect(block.content).not.toContain('FIRST_GENERATION')
      expect(block.content).not.toContain('SECOND_GENERATION')
      const prepared = await prepareGenerationPrompt(request)
      const prompt = buildGenerationPromptPreview(prepared)
      expect(prompt.compression?.compressedChapters).toBe(2)
      expect(prompt.userPrompt).toContain(original)
      expect(prompt.userPrompt).toContain(texts[2].trim())
      expect(prompt.userPrompt).not.toContain('FIRST_GENERATION')
      expect(prompt.userPrompt).not.toContain('SECOND_GENERATION')
    })
    expect(JSON.stringify(model.generateStructured.mock.calls)).not.toContain(original)
    expect(db.queryOne<{ latest_text: string }>('SELECT latest_text FROM continue_blocks WHERE id = ?', 'block-1')?.latest_text).toBe(texts[0])
    expect(db.queryOne<{ rawText: string }>('SELECT rawText FROM KnowledgeChapter WHERE id = ?', 'chapter-1')?.rawText).toBe(original)
    expect(getGeneratedHistory(scope, createDatabaseAccess(sqlite)).preview.compressedChapters).toBe(2)
  })

  it('extends an existing summary without sending compressed originals again', async () => {
    await compress(1)
    const model = gateway()
    await compress(2, scope, model)
    const sent = JSON.stringify(model.generateStructured.mock.calls)
    expect(sent).toContain('两人达成同盟')
    expect(sent).toContain('SECOND_GENERATION')
    expect(sent).not.toContain('FIRST_GENERATION')
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(2)
  })

  it('inherits a completed summary when new writing blocks arrive and only summarizes selected new chapters', async () => {
    await compress(3)
    for (const index of [4, 5]) {
      db.execute(`INSERT INTO continue_blocks (id, novel_id, branch_id, source_chapter_no, title, user_instruction, selected_text, original_text, latest_text) VALUES (?, ?, ?, 1, ?, '', ?, ?, ?)`, `block-${index}`, scope.novelId, scope.branchId, `Chapter ${index}`, original, original, `NEW_CHAPTER_${index} `.repeat(90))
      db.execute(`INSERT INTO story_timeline_nodes (id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, parent_node_id, continue_block_id) VALUES (?, ?, ?, 'continue_block', ?, 1, ?, ?, ?)`, `node-${index}`, scope.novelId, scope.branchId, index, `Chapter ${index}`, `node-${index - 1}`, `block-${index}`)
    }
    const extendedScope = { ...scope, branchContextNodeId: 'node-5' }
    expect(getGeneratedHistory(extendedScope, db).preview).toMatchObject({ totalChapters: 5, compressedChapters: 3 })
    const model = gateway()
    const result = await compress(4, extendedScope, model)
    expect(result).toMatchObject({ totalChapters: 5, compressedChapters: 4 })
    const sent = JSON.stringify(model.generateStructured.mock.calls)
    expect(sent).toContain('两人达成同盟')
    expect(sent).toContain('NEW_CHAPTER_4')
    for (const text of ['FIRST_GENERATION', 'SECOND_GENERATION', 'LATEST_GENERATION', 'NEW_CHAPTER_5']) expect(sent).not.toContain(text)
    expect(getGeneratedHistory(extendedScope, db).content).toContain('NEW_CHAPTER_5')
  })

  it('invalidates edited prefixes, rejects stale ranges and keeps sibling branches isolated', async () => {
    const old = getGeneratedHistory(scope, db).preview
    await compress(2)
    db.execute('UPDATE continue_blocks SET latest_text = ? WHERE id = ?', 'MODIFIED '.repeat(100), 'block-1')
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(0)
    await expect(compressGeneratedHistory({ scope, count: 2, fingerprint: old.fingerprint }, { db, gateway: gateway() as unknown as ModelGateway })).rejects.toMatchObject({ status: 409 })
    await expect(compress(4)).rejects.toMatchObject({ status: 400 })
    expect(() => getGeneratedHistory({ ...scope, branchId: 'another-branch' }, db)).toThrow('does not belong')
    db.execute('UPDATE story_timeline_nodes SET parent_node_id = NULL WHERE id = ?', 'node-3')
    expect(getGeneratedHistory(scope, db).preview).toMatchObject({ totalChapters: 1, compressedChapters: 0 })
  })

  it('batches long chapters and leaves existing summaries intact on model failure or concurrent edits', async () => {
    await compress(1)
    db.execute('UPDATE continue_blocks SET latest_text = ? WHERE id = ?', 'LONG_HISTORY '.repeat(5000), 'block-2')
    const model = gateway()
    model.generateStructured.mockImplementationOnce(async () => ({ data: { summary: '中间摘要' }, usage: { inputTokens: 1, outputTokens: 1 } })).mockRejectedValueOnce(new Error('provider failed'))
    await expect(compress(2, scope, model)).rejects.toThrow('provider failed')
    expect(model.generateStructured).toHaveBeenCalledTimes(2)
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(1)
    const editingModel = gateway()
    editingModel.generateStructured.mockImplementation(async () => {
      db.execute('UPDATE continue_blocks SET latest_text = ? WHERE id = ?', 'changed while summarizing', 'block-2')
      return { data: { summary: '摘要' }, usage: { inputTokens: 1, outputTokens: 1 } }
    })
    await expect(compress(2, scope, editingModel)).rejects.toMatchObject({ status: 409 })
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(1)
  })

  it('counts roleplay turns, follows only the selected conversation branch and removes compressed dialogue from provider prompts', async () => {
    db.execute(`INSERT INTO roleplay_sessions (id, novel_id, branch_id, title, source_chapter_no, source_selected_text, source_text_snapshot) VALUES ('rp', ?, ?, '对话', 1, ?, ?)`, scope.novelId, scope.branchId, original, original)
    for (const [index, role, parent] of [[1, 'user', null], [2, 'assistant', 'm1'], [3, 'user', 'm2'], [4, 'assistant', 'm3'], [5, 'assistant', 'm1']] as const) {
      db.execute(`INSERT INTO roleplay_messages (id, session_id, message_index, turn_index, role, content, parent_message_id) VALUES (?, 'rp', ?, ?, ?, ?, ?)`, `m${index}`, index, index, role, `DIALOGUE_${index} `.repeat(90), parent)
    }
    const rpScope: GeneratedHistoryScope = { novelId: scope.novelId, branchId: scope.branchId, roleplaySessionId: 'rp', roleplayLeafMessageId: 'm4' }
    expect(getGeneratedHistory(rpScope, db).preview.totalChapters).toBe(2)
    await compress(1, rpScope)
    const content = getGeneratedHistory(rpScope, db).content
    expect(content).not.toContain('DIALOGUE_1')
    expect(content).not.toContain('DIALOGUE_2')
    expect(content).toContain('DIALOGUE_3')
    expect(content).toContain('DIALOGUE_4')
    expect(content).not.toContain('DIALOGUE_5')
    expect(getGeneratedHistory({ ...rpScope, roleplayLeafMessageId: 'm5' }, db).preview.compressedChapters).toBe(0)
    await runWithDatabaseAccessScope(db, async () => {
      const prepared = await prepareGenerationPrompt({ ...rpScope, chapterId: 'chapter-1', sourceText: original, selectedText: original, operationType: 'roleplay', userInstruction: '继续', roleplayMessages: [{ role: 'assistant', content: 'DIALOGUE_2 '.repeat(90) }] })
      expect(prepared.requestPrompts.userPrompt).toContain('两人达成同盟')
      expect(prepared.requestPrompts.userPrompt).not.toContain('DIALOGUE_2')
      expect(prepared.requestPrompts.userPrompt).toContain('DIALOGUE_4')
      expect(prepared.requestPrompts.userPrompt).toContain(original)
    })
    await expand(rpScope)
    await runWithDatabaseAccessScope(db, async () => {
      const prepared = await prepareGenerationPrompt({ ...rpScope, chapterId: 'chapter-1', sourceText: original, selectedText: original, operationType: 'roleplay', userInstruction: '继续' })
      expect(prepared.requestPrompts.userPrompt).toContain('DIALOGUE_2')
      expect(prepared.requestPrompts.userPrompt).toContain('DIALOGUE_4')
      expect(prepared.requestPrompts.userPrompt).not.toContain('两人达成同盟')
      expect(prepared.requestPrompts.userPrompt).toContain(original)
    })
  })

  it('includes what-if nodes in the same ordered generated history and never falls back to original snapshots', async () => {
    db.execute(`INSERT INTO what_if_sessions (id, novel_id, base_branch_id, source_chapter_no, title, premise, selected_text, original_text, generated_text) VALUES ('if', ?, ?, 1, '假设', '', ?, ?, ?)`, scope.novelId, scope.branchId, original, original, 'WHAT_IF_GENERATED '.repeat(100))
    db.execute(`INSERT INTO story_timeline_nodes (id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, parent_node_id, what_if_session_id) VALUES ('if-node', ?, ?, 'what_if', 1, 1, '假设', 'node-3', 'if')`, scope.novelId, scope.branchId)
    const ifScope = { ...scope, branchContextNodeId: 'if-node' }
    expect(getGeneratedHistory(ifScope, db).preview.totalChapters).toBe(4)
    await compress(4, ifScope)
    expect(getGeneratedHistory(ifScope, db).content).not.toContain('WHAT_IF_GENERATED')
    await expand(ifScope)
    expect(getGeneratedHistory(ifScope, db).content).toContain('WHAT_IF_GENERATED')
    expect(getGeneratedHistory(ifScope, db).preview.compressedChapters).toBe(0)
    db.execute("UPDATE continue_blocks SET latest_text = '' WHERE id = 'block-1'")
    expect(getGeneratedHistory(ifScope, db).entries.some((entry) => entry.content.includes(original))).toBe(false)
  })
})

it('applies compression when generating a future jump from any generated source', async () => {
  db.execute(`INSERT INTO outline_nodes (id, novel_id, branch_id, chapter_no, title, summary, track_key, source_type, involved_entities_json, key_events_json) VALUES ('outline', ?, ?, 10, '未来', '未来节点', 'main', 'authored', '[]', '[]')`, scope.novelId, scope.branchId)
  db.execute(`INSERT INTO outline_node_chapters (id, outline_node_id, chapter_no) VALUES ('anchor', 'outline', 10)`)
  db.execute(`INSERT INTO future_jump_runs (id, base_branch_id, parent_timeline_node_id, source_timeline_node_type, source_text_snapshot, target_outline_node_id, target_outline_chapter_id, source_chapter_no, target_chapter_no, bridge_summary, generated_target_text) VALUES ('future', ?, 'node-3', 'continue_block', ?, 'outline', 'anchor', 1, 10, '桥接', ?)`, scope.branchId, original, 'FUTURE_GENERATED '.repeat(100))
  db.execute(`INSERT INTO story_timeline_nodes (id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, parent_node_id, future_jump_run_id) VALUES ('future-node', ?, ?, 'future_jump', 1, 1, '未来', 'node-3', 'future')`, scope.novelId, scope.branchId)
  const futureScope = { ...scope, branchContextNodeId: 'future-node' }
  expect(getGeneratedHistory(futureScope, db).preview.totalChapters).toBe(4)
  await compress(4, futureScope)
  const result = await previewFutureJumpContext({ novelId: scope.novelId, branchId: scope.branchId, sourceContext: { nodeId: 'future-node', nodeType: 'future_jump', chapterNo: 1, chapterId: 'chapter-1', whatIfSessionId: null }, targetOutlineNodeId: 'outline', targetOutlineChapterId: 'anchor' })
  expect(result.compression?.compressedChapters).toBe(4)
  const request = vi.mocked(applyPresetCompatCreativeRuntime).mock.calls.at(-1)![0]
  expect(request.userPrompt).toContain('两人达成同盟')
  expect(request.userPrompt).not.toContain('FIRST_GENERATION')
  expect(request.userPrompt).not.toContain('FUTURE_GENERATED')
  await expand(futureScope)
  const expanded = await previewFutureJumpContext({ novelId: scope.novelId, branchId: scope.branchId, sourceContext: { nodeId: 'future-node', nodeType: 'future_jump', chapterNo: 1, chapterId: 'chapter-1', whatIfSessionId: null }, targetOutlineNodeId: 'outline', targetOutlineChapterId: 'anchor' })
  expect(expanded.compression?.compressedChapters).toBe(0)
  const expandedPrompt = vi.mocked(applyPresetCompatCreativeRuntime).mock.calls.at(-1)![0].userPrompt
  expect(expandedPrompt).toContain('FIRST_GENERATION')
  expect(expandedPrompt).toContain('FUTURE_GENERATED')
  expect(expandedPrompt).not.toContain('两人达成同盟')
})

it('persists summaries through the compression API and rejects invalid or stale selections', async () => {
  const model = vi.spyOn(ConfiguredWritingSkillModelGateway.prototype, 'generateStructured').mockResolvedValue({ data: { summary: '他们决定共同守城。' }, usage: { inputTokens: 100, outputTokens: 10 } })
  const post = (body: unknown) => compressionRoute(new Request('http://localhost/api/context/compress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  try {
    const read = await post({ scope })
    const { compression } = await read.json()
    expect(compression.totalChapters).toBe(3)
    expect((await post({ scope, count: 0, fingerprint: compression.fingerprint })).status).toBe(400)
    expect((await post({ scope, count: 1, fingerprint: 'outdated' })).status).toBe(409)
    const saved = await post({ scope, count: 2, fingerprint: compression.fingerprint })
    expect(saved.status).toBe(200)
    const compressed = (await saved.json()).compression
    expect(compressed.compressedChapters).toBe(2)
    expect(model).toHaveBeenCalledOnce()
    expect(getGeneratedHistory(scope, db).content).not.toContain('FIRST_GENERATION')
    const remove = (body: unknown) => expansionRoute(new Request('http://localhost/api/context/compress', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
    expect((await remove({ scope })).status).toBe(400)
    expect((await remove({ scope, fingerprint: compression.fingerprint })).status).toBe(409)
    expect(getGeneratedHistory(scope, db).preview.compressedChapters).toBe(2)
    const expanded = await remove({ scope, fingerprint: compressed.fingerprint })
    expect(expanded.status).toBe(200)
    expect((await expanded.json()).compression).toMatchObject({ compressedChapters: 0, summary: null })
    expect(model).toHaveBeenCalledOnce()
    expect(getGeneratedHistory(scope, db).content).toContain('FIRST_GENERATION')
  } finally { model.mockRestore() }
})

it('does not reinsert a compressed generated source as the roleplay starting snapshot', async () => {
  db.execute(`INSERT INTO roleplay_sessions (id, novel_id, branch_id, title, source_chapter_no, source_selected_text, source_text_snapshot, source_timeline_node_id, source_timeline_node_type) VALUES ('rp-source', ?, ?, '对话', 1, ?, ?, 'node-1', 'rewrite')`, scope.novelId, scope.branchId, texts[0], texts[0])
  const rpScope: GeneratedHistoryScope = { novelId: scope.novelId, branchId: scope.branchId, roleplaySessionId: 'rp-source', roleplayLeafMessageId: null }
  await compress(1, rpScope)
  await runWithDatabaseAccessScope(db, async () => {
    const prepared = await prepareGenerationPrompt({ ...rpScope, chapterId: 'chapter-1', selectedText: texts[0], sourceText: texts[0], operationType: 'roleplay', userInstruction: '继续' })
    expect(prepared.requestPrompts.userPrompt).toContain('两人达成同盟')
    expect(prepared.requestPrompts.userPrompt).not.toContain('FIRST_GENERATION')
  })
})
