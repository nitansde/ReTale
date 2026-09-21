import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseAccess } from '@/lib/server/database-access'
import { initializeDatabase } from '@/lib/server/sqlite'
import { CONTROL_SCHEMA_SQL } from '@/lib/server/schema'
import { saveWritingSkillCard } from '@/lib/server/writing-skill-store'
import type { MaterialLibrary } from '@/lib/server/writing-skill-material'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { createDefaultAISettings } from '@/lib/ai-settings'
import type { RoleplayPromptPreview } from '@/lib/roleplay-generation'

let database: DatabaseSync | undefined
afterEach(() => { database?.close(); database = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

async function setup(provider: 'openai-compatible' | 'ollama' = 'openai-compatible') {
  database = initializeDatabase(new DatabaseSync(':memory:'), { mode: 'control', schemaSql: CONTROL_SCHEMA_SQL })
  const db = createDatabaseAccess(database)
  const paragraphs = ['范文甲：她把话咽了回去，指尖轻叩杯沿。', '范文乙：风吹动帘角，雨声掩住叹息。'].map((text, index) => ({
    id: `p${index}`, libraryId: 'material', libraryVersion: 'v1', workId: 'work', chapterId: `c${index}`, chapterIndex: index + 1,
    paragraphIndex: 1, anonymizedText: text, estimatedTokens: 20, displayRef: `W1-C${index + 1}-P1`,
  }))
  const library: MaterialLibrary = { id: 'material', version: 'v1', name: '素材库', author: null, workId: 'work', paragraphs, totalTokens: 40, chapterIds: ['c0', 'c1'], paragraphByDisplayRef: new Map(paragraphs.map((p) => [p.displayRef, p])), paragraphById: new Map(paragraphs.map((p) => [p.id, p])) }
  const cards = await Promise.all(paragraphs.map((p, index) => saveWritingSkillCard({
    libraryId: library.id, libraryVersion: library.version, libraryName: library.name, userInstruction: '描写互动', modelConfigId: 'fixture', sourceJobId: `job${index}`,
    result: { title: `技巧${index}`, summary: `技巧概述${index}`, rules: [{ text: `独特写作方法${index}：用动作表现迟疑。`, evidenceRefs: [p.displayRef] }], applicationScope: '角色对话与旁白', avoid: [`避免标签化描写${index}`] },
    examples: [{ rangeRef: { libraryId: library.id, libraryVersion: library.version, workId: library.workId, chapterId: p.chapterId, startParagraphId: p.id, endParagraphId: p.id }, displayRef: p.displayRef, score: 1 }],
  }, db)))
  // Use real stored cards, example selection and prompt compilation. Only source
  // retrieval and the external model response are fixtures.
  const skillResolutions = vi.fn()
  vi.doMock('@/lib/server/writing-skill-runtime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/server/writing-skill-runtime')>()
    return { ...actual, resolveWritingSkillRuntimes: (input: Parameters<typeof actual.resolveWritingSkillRuntimes>[0]) => {
      skillResolutions(input)
      return actual.resolveWritingSkillRuntimes({ ...input, db, library })
    } }
  })
  vi.doMock('@/lib/server/database-access', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/server/database-access')>()),
    runWithNovelDatabaseAccess: (_id: string, callback: () => unknown) => callback(),
    queryOne: () => ({ id: 'chapter', chapterNo: 1, title: '起点', rawText: '两人站在门外。', summary: '摘要哨兵：原先约好去茶馆。' }),
    queryAll: (sql: string) => sql.includes('FROM ChapterLine') ? [{ lineNo: 1, text: '两人站在门外。' }] : [],
  }))
  vi.doMock('@/lib/server/graph-context', () => ({ buildChapterScopedGraphContext: vi.fn(), buildGraphAwareContext: async () => ({ seedEntities: [], nodes: [], edges: [], contextText: '', warnings: [], tokenEstimate: 0 }) }))
  vi.doMock('@/lib/server/authored-context', () => ({ loadExplicitAuthoredContext: () => null }))
  vi.doMock('@/lib/server/graph-store', () => ({ loadEntityStatesByEntityIds: () => [] }))
  vi.doMock('@/lib/server/story-timeline-store', () => ({ findStoryTimelineNodeById: () => null }))
  vi.doMock('@/lib/server/knowledge-store', () => ({ normalizeBranchId: (id: string, branch?: string) => branch ?? `${id}:main` }))
  vi.doMock('@/lib/server/retrieval-index', () => ({ searchLanceEvidence: async () => ({ matches: [], warning: null }) }))
  vi.doMock('@/lib/server/generation-context-snapshot', () => ({ loadGenerationContextSnapshot: () => null, createGenerationContextSnapshot: () => 'preview-snapshot' }))
  vi.doMock('@/lib/server/preset-compat-library', () => ({ loadStoredPresetCompatLibrary: () => createDefaultPresetCompatLibrary() }))
  const settings = createDefaultAISettings()
  settings.rewrite.provider = provider
  settings.rewrite.ollama = { ...settings.rewrite.ollama, baseUrl: 'http://localhost:11434', model: 'fixture' }
  settings.rewrite.openAICompatible = { ...settings.rewrite.openAICompatible, baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'fixture' }
  vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => settings }))
  const providerRequests: Array<{ stream?: boolean; messages: Array<{ role: string; content: string }> }> = []
  const reply = JSON.stringify({ result: '她收回视线，我们继续吧。', blocks: [{ type: 'counterpart', text: '她收回视线。“我们继续吧。”' }] })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
    if (String(_url).endsWith('/api/tags')) return Response.json({ models: [{ model: 'fixture' }] })
    const body = JSON.parse(String(init?.body)); providerRequests.push(body)
    if (provider === 'ollama') return body.stream
      ? new Response(`${JSON.stringify({ message: { content: reply }, done: true })}\n`)
      : Response.json({ message: { content: reply } })
    return body.stream ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`) : Response.json({ choices: [{ message: { content: reply } }] })
  }))
  const { POST: generate } = await import('@/app/api/rewrite/route')
  const { POST: rewritePreview } = await import('@/app/api/rag/build-generation-context/route')
  const { POST: preview } = await import('@/app/api/roleplay/preview/route')
  const request = (stream: boolean, disabledBlockIds: string[] = [], chapterId: string | null = 'chapter') => ({
    novelId: 'novel', branchId: 'novel:main', chapterId, operationType: 'roleplay', selectedText: '两人站在门外。', sourceText: '两人站在门外。', stream,
    roleplayMessages: [{ role: 'user', content: '先去茶馆吧。' }, { role: 'assistant', content: '旁白：两人已坐进茶馆。\n乙：想喝什么？' }],
    roleplayTurn: { playerName: '甲', counterpartName: '乙', storyGuidance: '她替我斟茶。', dialogue: '就喝你喜欢的。', maxCharacters: 600, generationOptions: { writingSkillCardIds: cards.map((card) => card.id), writingSkillExampleCount: 1, writingSkillSeed: 73, disabledBlockIds } },
  })
  const httpRequest = (body: unknown) => new Request('http://localhost/api/roleplay/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { cards, paragraphs, providerRequests, generate, preview, rewritePreview, request, httpRequest, skillResolutions }
}

describe('roleplay generation options reach the final provider prompt', () => {
  it.each((['openai-compatible', 'ollama'] as const).flatMap((provider) =>
    [false, true].flatMap((stream) => (['rewrite', 'continue', 'regenerate', 'roleplay'] as const).map((mode) => ({ provider, stream, mode }))),
  ))('matches all preview blocks to real provider requests (%j)', async ({ provider, stream, mode }) => {
    const { cards, paragraphs, providerRequests, generate, preview, rewritePreview, request, httpRequest, skillResolutions } = await setup(provider)
    for (const disabled of [[], ['current-summary', `writing-skill:${cards[1].id}`]]) {
      const roleplayInput = request(stream, disabled)
      const input = mode === 'roleplay' ? roleplayInput : {
        ...roleplayInput, operationType: 'rewrite', roleplayTurn: undefined, userInstruction: '继续斟茶。',
        ...roleplayInput.roleplayTurn.generationOptions,
        ...(mode === 'continue' ? { selectedText: '', sourceText: '两人站在门外。已有续写停在斟茶之前。' } : {}),
        ...(mode === 'regenerate' ? { sourceText: '两人站在门外。上次生成的版本。', selectedText: '上次生成的版本。' } : {}),
      }
      const before = providerRequests.length
      skillResolutions.mockClear()
      const previewResponse = await (mode === 'roleplay' ? preview : rewritePreview)(httpRequest(input))
      expect(previewResponse.status).toBe(200)
      expect(skillResolutions).toHaveBeenCalledOnce()
      const shown = await previewResponse.json() as RoleplayPromptPreview
      expect(providerRequests).toHaveLength(before)
      const response = await generate(httpRequest(input))
      expect(response.status).toBe(200)
      expect(skillResolutions).toHaveBeenCalledTimes(2)
      await response.text()
      const sent = providerRequests.at(-1)!.messages
      expect(sent).toEqual([{ role: 'system', content: shown.systemPrompt }, { role: 'user', content: shown.userPrompt }])
      expect(shown.requestMessages?.map((message) => ({ role: message.role, content: message.blocks.map((block) => block.content).join('') }))).toEqual(sent)
      const requestBlocks = shown.requestMessages!.flatMap((message) => message.blocks)
      const neighborhoodIndex = requestBlocks.findIndex((block) => block.contextBlockId === 'neighborhood')
      if (mode !== 'continue') {
        expect(neighborhoodIndex).toBeGreaterThanOrEqual(0)
        expect(requestBlocks.slice(neighborhoodIndex + 1).find((block) => block.content.trim())?.contextBlockId).toBe('selected-text')
      }
      expect(shown.requestMessages!.find((message) => message.role === 'system')!.blocks.filter((block) => block.kind === 'preset')).toHaveLength(1)
      expect(requestBlocks.filter((block) => block.contextBlockId).map((block) => block.contextBlockId).sort())
        .toEqual(shown.promptBlocks.filter((block) => block.enabled && !block.trimmed).map((block) => block.id).sort())
      expect(shown.systemPrompt.length).toBeGreaterThan(0)
      const prompt = shown.userPrompt
      expect(prompt.split('独特写作方法0').length - 1).toBe(1)
      expect(prompt.split(paragraphs[0].anonymizedText).length - 1).toBe(1)
      expect(prompt).toContain('# 任务')
      expect(prompt).not.toContain('选中行：')
      expect(prompt.indexOf('# 前情最近 5 章正文')).toBeLessThan(prompt.indexOf(mode === 'continue' ? '# 已有正文' : '# 选区附近正文'))
      expect(prompt.indexOf('# Lance 检索证据')).toBeGreaterThan(prompt.indexOf('两人站在门外。'))
      expect(prompt.indexOf('## 本次指定写作技巧')).toBeGreaterThan(prompt.indexOf('# Lance 检索证据'))
      expect(prompt.lastIndexOf('# 任务')).toBeGreaterThan(prompt.indexOf(paragraphs[0].anonymizedText))
      if (mode === 'roleplay') {
        expect(prompt).toContain('两人已坐进茶馆')
        expect(prompt).toContain('双角色互动输出要求')
        expect(shown.promptBlocks.some((block) => block.id === 'output-constraints')).toBe(false)
        expect(prompt).not.toMatch(/^# 输出要求$/m)
        for (const rule of ['不要输出剧情大纲或格式说明。', '不要自动应用、改写或续写原章节正文。']) {
          expect(prompt.split(rule)).toHaveLength(2)
          expect(prompt.indexOf(rule)).toBeLessThan(prompt.indexOf('# 前情最近 5 章正文'))
        }
        expect(`${shown.systemPrompt}\n${prompt}`).not.toMatch(/galgame|视觉小说/i)
        expect(prompt).not.toContain('严格遵守当前魔改输出契约')
        expect(prompt.indexOf('# Lance 检索证据')).toBeGreaterThan(prompt.indexOf('两人已坐进茶馆'))
        expect(prompt.split(roleplayInput.roleplayTurn.storyGuidance)).toHaveLength(2)
        expect(prompt.split(roleplayInput.roleplayTurn.dialogue)).toHaveLength(2)
        expect(prompt.indexOf('目标字数约为 600 字')).toBeGreaterThan(prompt.lastIndexOf('# 任务'))
      } else {
        expect(prompt).toContain('继续斟茶。')
        expect(prompt).toContain('严格遵守当前魔改输出契约')
        expect(prompt.split('继续斟茶。')).toHaveLength(2)
        expect(shown.promptBlocks.some((block) => block.id === 'output-constraints')).toBe(true)
        expect(prompt.match(/^# 输出要求$/gm)).toHaveLength(1)
        if (mode === 'continue') {
          expect(prompt).toContain('任务类型：续写后续故事')
          expect(prompt.split(input.sourceText)).toHaveLength(2)
          expect(prompt).not.toMatch(/^# 选中文本$/m)
        }
      }
      if (disabled.length) {
        expect(prompt).not.toContain('摘要哨兵')
        expect(prompt).not.toContain('独特写作方法1')
        expect(prompt).not.toContain(paragraphs[1].anonymizedText)
        expect(shown.writingSkillRecords.map((record) => record.skillCardId)).toEqual([cards[0].id])
        expect(shown.promptBlocks.find((block) => block.id === 'current-summary')).toMatchObject({ enabled: false })
      } else {
        expect(prompt).toContain('摘要哨兵')
        expect(prompt).toContain(paragraphs[1].anonymizedText)
        expect(shown.writingSkillRecords).toHaveLength(2)
      }
      if (mode === 'roleplay') expect(shown.promptBlocks.find((block) => block.id === 'roleplay-history')).toMatchObject({ required: true, enabled: true })
    }
  })
  it('includes skills without a source chapter and permits empty input only for preview', async () => {
    const { paragraphs, providerRequests, generate, preview, request, httpRequest } = await setup()
    const input = request(false, [], null)
    const shown = await (await preview(httpRequest(input))).json() as RoleplayPromptPreview
    expect(shown.userPrompt).toContain(paragraphs[0].anonymizedText)
    expect(shown.userPrompt).toContain('两人已坐进茶馆')
    expect(shown.userPrompt).toContain('不要输出剧情大纲或格式说明。不要自动应用、改写或续写原章节正文。')
    expect(shown.userPrompt).not.toMatch(/^# 输出要求$/m)
    const empty = { ...input, roleplayTurn: { ...input.roleplayTurn, storyGuidance: '', dialogue: '' } }
    expect((await preview(httpRequest(empty))).status).toBe(200)
    expect((await generate(httpRequest(empty))).status).toBe(400)
    expect(providerRequests).toHaveLength(0)
  })
})
