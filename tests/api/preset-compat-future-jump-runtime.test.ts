import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PresetCompatMacroDiagnostic } from '@/lib/preset-compat/macro-context'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'
import type { AISettings } from '@/lib/types'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync; fetch?: typeof fetch }

async function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = new DatabaseSync(tempDatabase.dbPath)
  globalForSqlite.sqlite = database
  vi.resetModules()

  const { initializeDatabase } = await import('@/lib/server/sqlite')
  initializeDatabase(database)
  return database
}

function createAiSettings(): AISettings {
  return {
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'rewrite-model',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'rewrite-ollama',
      },
    },
    knowledgeExtraction: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'knowledge-model',
        parallelism: 1,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'knowledge-ollama',
        parallelism: 1,
      },
    },
    embeddings: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'embedding-model',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'embedding-ollama',
      },
      embeddingBatchSize: 16,
    },
  }
}

function createRuntimeLibrary() {
  const library = createDefaultPresetCompatLibrary()

  library.standaloneRegexes['regex-input'] = {
    id: 'regex-input',
    name: 'Input regex',
    pattern: 'ALPHA',
    replacement: 'BETA',
    flags: 'g',
    disabled: false,
    placements: ['user_input'],
    trimStrings: [],
    promptOnly: true,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: true,
    passthrough: {},
  }
  library.standaloneRegexes['regex-output'] = {
    id: 'regex-output',
    name: 'Output regex',
    pattern: 'AlphaBeta',
    replacement: 'Omega',
    flags: 'g',
    disabled: false,
    placements: ['assistant_output'],
    trimStrings: [],
    promptOnly: false,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: true,
    passthrough: {},
  }

  library.presets['future-jump-preset'] = {
    id: 'future-jump-preset',
    name: 'Future jump preset',
    sourceApiId: 'openai',
    promptRules: [
      {
        id: 'fj-user-rule',
        name: 'Future jump user rule',
        role: 'user',
        content: 'FUTURE JUMP USER RULE',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 1,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'fj-system-rule',
        name: 'Future jump system rule',
        role: 'system',
        content: 'FUTURE JUMP SYSTEM RULE',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 2,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'fj-system-rule-second',
        name: 'Future jump second system rule',
        role: 'system',
        content: 'FUTURE JUMP SECOND SYSTEM RULE',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 3,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
    ],
    promptOrderLists: {
      future_jump_rewrite: ['fj-user-rule', 'fj-system-rule', 'fj-system-rule-second'],
      future_jump_bridge: ['fj-user-rule', 'fj-system-rule', 'fj-system-rule-second'],
      what_if_delta_extraction: ['fj-user-rule', 'fj-system-rule', 'fj-system-rule-second'],
      knowledge_extraction: ['fj-user-rule', 'fj-system-rule', 'fj-system-rule-second'],
      embeddings: ['fj-user-rule', 'fj-system-rule', 'fj-system-rule-second'],
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: ['regex-input', 'regex-output'],
    runtimeSampler: {
      temperature: 0.44,
      topP: 0.87,
      topK: 55,
      topA: null,
      minP: 0.08,
      presencePenalty: 0.29,
      frequencyPenalty: 0.18,
      repetitionPenalty: 1.22,
      openaiMaxContext: 4096,
      maxTokens: 3333,
        seed: 24680,
      candidateCount: null,
    },
    promptTemplate: {
      namesBehavior: null,
      sendIfEmpty: null,
      impersonationPrompt: null,
      newChatPrompt: 'FUTURE JUMP NEW CHAT TEMPLATE',
      newGroupChatPrompt: null,
      newExampleChatPrompt: null,
      continueNudgePrompt: 'FUTURE JUMP CONTINUE TEMPLATE',
      wiFormat: null,
      scenarioFormat: null,
      personalityFormat: null,
      groupNudgePrompt: null,
      assistantPrefill: null,
      assistantImpersonation: null,
      continuePostfix: null,
      legacyMainPrompt: null,
      legacyNsfwPrompt: null,
      legacyJailbreakPrompt: null,
    },
    transport: {
      maxContextUnlocked: true,
      streamOpenAI: true,
      useSysprompt: null,
      squashSystemMessages: null,
      mediaInlining: null,
      inlineImageQuality: null,
      continuePrefill: null,
      functionCalling: null,
      showThoughts: null,
      reasoningEffort: null,
      verbosity: null,
      enableWebSearch: null,
      requestImages: null,
      requestImageAspectRatio: null,
      requestImageResolution: null,
    },
    preservedFields: {
      biasPresetSelected: null,
    },
    passthrough: {},
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  }

  for (const surfaceId of ['future_jump_rewrite', 'future_jump_bridge', 'what_if_delta_extraction', 'knowledge_extraction', 'embeddings'] as const) {
    library.surfaceBindings[surfaceId] = {
      ...library.surfaceBindings[surfaceId],
      enabled: true,
      presetId: 'future-jump-preset',
    }
  }

  return library
}

function createMacroRuntimeLibrary() {
  const library = createDefaultPresetCompatLibrary()

  library.presets['future-jump-macro-preset'] = {
    id: 'future-jump-macro-preset',
    name: 'Future jump macro preset',
    sourceApiId: 'openai',
    promptRules: [
      {
        id: 'fj-macro-user-rule',
        name: 'Future jump macro user rule',
        role: 'user',
        content: 'Future rewrite {{user}} -> {{char}}. Unsupported={{input}} Missing={{lastMessage}}.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 1,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
    ],
    promptOrderLists: {
      future_jump_rewrite: ['fj-macro-user-rule'],
      future_jump_bridge: ['fj-macro-user-rule'],
      what_if_delta_extraction: ['fj-macro-user-rule'],
      knowledge_extraction: ['fj-macro-user-rule'],
      embeddings: ['fj-macro-user-rule'],
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: 0.44,
      topP: null,
      topK: null,
      topA: null,
      minP: null,
      presencePenalty: null,
      frequencyPenalty: null,
      repetitionPenalty: null,
      openaiMaxContext: null,
      maxTokens: 3333,
      seed: 1357,
      candidateCount: null,
    },
    promptTemplate: {
      namesBehavior: 1,
      sendIfEmpty: null,
      impersonationPrompt: null,
      newChatPrompt: null,
      newGroupChatPrompt: null,
      newExampleChatPrompt: null,
      continueNudgePrompt: null,
      wiFormat: null,
      scenarioFormat: null,
      personalityFormat: null,
      groupNudgePrompt: null,
      assistantPrefill: null,
      assistantImpersonation: null,
      continuePostfix: null,
      legacyMainPrompt: null,
      legacyNsfwPrompt: null,
      legacyJailbreakPrompt: null,
    },
    transport: {
      maxContextUnlocked: null,
      streamOpenAI: null,
      useSysprompt: null,
      squashSystemMessages: null,
      mediaInlining: null,
      inlineImageQuality: null,
      continuePrefill: null,
      functionCalling: null,
      showThoughts: null,
      reasoningEffort: null,
      verbosity: null,
      enableWebSearch: null,
      requestImages: null,
      requestImageAspectRatio: null,
      requestImageResolution: null,
    },
    preservedFields: {
      biasPresetSelected: null,
    },
    passthrough: {},
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  }

  for (const surfaceId of ['future_jump_rewrite', 'future_jump_bridge', 'what_if_delta_extraction', 'knowledge_extraction', 'embeddings'] as const) {
    library.surfaceBindings[surfaceId] = {
      ...library.surfaceBindings[surfaceId],
      enabled: true,
      presetId: 'future-jump-macro-preset',
    }
  }

  return library
}

function seedFutureJumpFixture(database: DatabaseSync) {
  database.prepare(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-001:main', 'novel-001', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章 决裂', '男主和女主在这里 ALPHA 决裂。', '两人在这一章决裂。', 1, 0, null, 'hash-10', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章 绑走', '原线里女主会在这里被绑走。', '原线中这里会发生绑走。', 1, 0, null, 'hash-100', 'ready')

  database.prepare(`INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, status, importance, userConfirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('entity-male', 'novel-001', 'novel-001:main', 'character', '男主', '主角', 1, 100, 'user_confirmed', 5, 1)
  database.prepare(`INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, status, importance, userConfirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('entity-female', 'novel-001', 'novel-001:main', 'character', '女主', '主角', 1, 100, 'user_confirmed', 5, 1)
  database.prepare(`INSERT INTO EntityState (id, novelId, branchId, entityId, stateType, stateValue, description, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('state-male', 'novel-001', 'novel-001:main', 'entity-male', 'stance', '不再信任女主', '男主开始怀疑女主。', 10, 10, 999999, null, null, 0.9, 'user_confirmed', 1)
  database.prepare(`INSERT INTO EntityState (id, novelId, branchId, entityId, stateType, stateValue, description, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('state-female', 'novel-001', 'novel-001:main', 'entity-female', 'stance', '对男主失望', '女主受伤。', 10, 10, 999999, null, null, 0.9, 'user_confirmed', 1)
  database.prepare(`INSERT INTO KnowledgeRelation (id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId, confidence, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run('rel-1', 'novel-001', 'novel-001:main', 'entity-male', 'entity-female', 'alliance', 'negative', 5, 10, 10, 999999, null, 0.9, 'user_confirmed')
  database.prepare(`INSERT INTO KnowledgeEvent (id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd, importance, consequences, evidenceSpanId, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('event-10', 'novel-001', 'novel-001:main', '决裂', '两人决裂。', 'major', 10, null, null, 5, '关系受损。', null, 'user_confirmed')
  database.prepare(`INSERT INTO KnowledgeWorld (id, novelId, branchId, term, category, definition, firstSeenChapter, validFromChapter, validUntilChapter, evidenceSpanId, status, confidence, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run('world-1', 'novel-001', 'novel-001:main', '反派情报网', 'faction', '反派长期监视。', 5, 5, 999999, null, 'user_confirmed', 0.8)
  database.prepare(`INSERT INTO KnowledgeFact (id, novelId, branchId, factType, subjectEntityId, predicate, objectEntityId, valueJson, sourceChapter, validFromChapter, validUntilChapter, confidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('thread-1', 'novel-001', 'novel-001:main', 'open_thread', null, '泄密者是谁', null, JSON.stringify({ description: '真正的泄密者还未知。' }), 10, 10, 999999, 0.7, 'user_confirmed')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-001', 'novel-001', 'novel-001:main', 10, 'IF 决裂线', '让男女主在这里 ALPHA 决裂。', '决裂选段', '原文片段', '改写片段', 'active')

  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('delta-1', 'what-if-001', 'relationship_change', '男主', '女主', 'entity-male', 'entity-female', '信任关系', '勉强同盟', '公开决裂', 10, '两人的互信崩塌。', 0.95)

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-100', 'novel-001', 'novel-001:main', 100, '女主被反派绑走', '反派在这里抓住女主。', '原线里男主及时救援。', 'phase-3', '第三阶段', 'authored', 1, '["男主","女主"]', '["绑走"]', 100)

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-anchor-100', 'outline-100', 100, 'chapter-100', '第100章 绑走', 1, 0)
}

function seedWhatIfFixture(database: DatabaseSync) {
  database.prepare(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`).run('novel-whatif', 'WhatIf Novel', 'Fixture Author', 'txt')
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-whatif:main', 'novel-whatif', 'main', null)
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-whatif', 'novel-whatif', 'novel-whatif:main', 10, '第10章', '第10章内容', '第10章摘要', 1, 0, null, 'hash-10', 'ready')
  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text) VALUES (?, ?, ?, ?)').run('line-whatif-1', 'chapter-whatif', 1, '男主和女主暂时结盟，准备一起行动。')
  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text) VALUES (?, ?, ?, ?)').run('line-whatif-2', 'chapter-whatif', 2, '他们都还相信对方。')
  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-existing', 'novel-whatif', 'novel-whatif:main', 10, 'IF-01 决裂线', '旧前提', '旧选区', '旧正文', '旧生成', 'active')
  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('timeline-node-001', 'novel-whatif', 'novel-whatif:main', 'what_if', 1, 10, 'IF-01 决裂线', '旧摘要', null, 10, null, null, 'what-if-existing', null, 0, 'violet', 'active')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('preset compat future jump runtime', () => {
  it('applies runtime only to future-jump rewrite while bridge stays fail-closed', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createRuntimeLibrary(),
    }))

    const database = await createTestDatabase('chatbook-preset-compat-future-jump')
    seedFutureJumpFixture(database)

    const bridgeSummary = '桥'.repeat(350)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: 'AlphaBeta', titleHint: 'Title AlphaBeta', subtitleHint: 'Subtitle AlphaBeta' }) } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const service = await import('@/lib/server/future-jump-service')
    const result = await service.generateFutureJump({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      whatIfSessionId: 'what-if-001',
      targetOutlineNodeId: 'outline-100',
      targetOutlineChapterId: 'outline-anchor-100',
      userDirection: '让结果更虐 ALPHA，但仍保持人物一致。',
    })

    expect(result.run.bridgeSummary).toBe(bridgeSummary)
    expect(result.run.generatedTargetText).toBe('Omega')
    expect(result.titleHint).toBe('Title Omega')
    expect(result.subtitleHint).toBe('Subtitle Omega')
    expect(result.presetCompat).toMatchObject({
      contextWindow: {
        supported: false,
        requestedMaxContextTokens: 4096,
        effectiveMaxContextTokens: null,
        unlockMaximum: false,
        trimmedBlockIds: [],
      },
      streamPolicy: {
        supported: false,
        requested: true,
        effective: false,
        source: 'route_unsupported',
      },
    })
    expect(result.presetCompat?.fieldStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'openai_max_context', status: 'degraded', reason: 'ROUTE_UNSUPPORTED' }),
      expect.objectContaining({ field: 'max_context_unlocked', status: 'preserved', reason: 'PRESERVED_EXPORT_ONLY' }),
      expect.objectContaining({ field: 'stream_openai', status: 'degraded', reason: 'ROUTE_UNSUPPORTED' }),
      expect.objectContaining({ field: 'openai_max_tokens', status: 'applied', reason: 'SUPPORTED_RUNTIME' }),
      expect.objectContaining({ field: 'seed', status: 'degraded', reason: 'PROVIDER_ONLY' }),
    ]))

    const bridgeBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      temperature?: number
      top_p?: number
      max_tokens?: number
      messages: Array<{ content: string }>
    }
    expect(bridgeBody.temperature).toBe(0.7)
    expect(bridgeBody.top_p).toBeUndefined()
    expect(bridgeBody.max_tokens).toBeUndefined()
    expect(bridgeBody.messages[0]?.content).not.toContain('## Imported Preset System Rules')
    expect(bridgeBody.messages[1]?.content).not.toContain('## Imported Preset User Rules')
    expect(bridgeBody.messages[1]?.content).toContain('ALPHA')

    const rewriteBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      seed?: number
      temperature?: number
      top_p?: number
      frequency_penalty?: number
      presence_penalty?: number
      max_tokens?: number
      messages: Array<{ content: string }>
    }
    expect(rewriteBody.temperature).toBe(0.44)
    expect(rewriteBody.top_p).toBe(0.87)
    expect(rewriteBody.frequency_penalty).toBe(0.18)
    expect(rewriteBody.presence_penalty).toBe(0.29)
    expect(rewriteBody.max_tokens).toBe(3333)
    expect(rewriteBody.seed).toBeUndefined()
    expect(rewriteBody.messages[0]?.content).not.toContain('FUTURE JUMP NEW CHAT TEMPLATE')
    expect(rewriteBody.messages[0]?.content).not.toContain('FUTURE JUMP CONTINUE TEMPLATE')
    expect(rewriteBody.messages[0]?.content).not.toContain('## Imported Preset System Rules')
    expect(rewriteBody.messages[0]?.content).toBe([
      'FUTURE JUMP SYSTEM RULE',
      'FUTURE JUMP SECOND SYSTEM RULE',
    ].join('\n\n'))
    expect(rewriteBody.messages[1]?.content.startsWith('FUTURE JUMP USER RULE')).toBe(true)
    expect(rewriteBody.messages[1]?.content).not.toContain('## Imported Preset User Rules')
    expect(rewriteBody.messages[1]?.content).toContain('BETA')
    expect(rewriteBody.messages[1]?.content).not.toContain('ALPHA')
  })

  it('keeps what-if, knowledge extraction, and embeddings fail-closed', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createRuntimeLibrary(),
    }))

    const database = await createTestDatabase('chatbook-preset-compat-fail-closed')
    seedWhatIfFixture(database)

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              deltas: [{
                delta_type: 'relationship_change',
                subject_name: '男主',
                target_name: '女主',
                key: 'relationship',
                old_value: '结盟',
                new_value: '决裂',
                valid_from_chapter: 10,
                description: '两人公开决裂。',
                confidence: 0.9,
              }],
            }),
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              chapter_no: 10,
              summary: '知识摘要',
              characters: [],
              relations: [],
              events: [],
              worldbuilding: [],
              open_threads: [{
                name: '悬而未决的问题',
                description: '仍然没有答案。',
                evidence: [],
              }],
            }),
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        model: 'embedding-model',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/what-if/sessions/route')
    const whatIfResponse = await POST(new Request('http://localhost/api/what-if/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-whatif',
        branchId: 'novel-whatif:main',
        sourceChapterNo: 10,
        selectedText: '男主和女主暂时结盟。',
        originalText: '第10章内容 ALPHA',
        generatedText: '男主和女主在这里 ALPHA 决裂。',
        userInstruction: '让两人在这里 ALPHA 彻底决裂。',
        titleHint: '决裂线',
      }),
    }))
    expect(whatIfResponse.status).toBe(200)

    const whatIfBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      temperature?: number
      messages: Array<{ content: string }>
    }
    expect(whatIfBody.temperature).toBe(0)
    expect(whatIfBody.messages[0]?.content).not.toContain('Imported Preset')
    expect(whatIfBody.messages[1]?.content).toContain('ALPHA')
    expect(whatIfBody.messages[1]?.content).not.toContain('BETA')

    const { extractChapterKnowledgeWithOpenAICompatible, embedTextsWithOpenAICompatible } = await import('@/lib/server/openai-compatible')
    const extractionResult = await extractChapterKnowledgeWithOpenAICompatible({
      chapterTitle: '第10章',
      chapterNo: 10,
      rawText: '知识正文 ALPHA',
      mode: 'focused',
    }, {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'knowledge-model',
    })
    expect(extractionResult.enabled).toBe(true)
    expect(extractionResult.extraction?.chapterNo).toBe(10)

    const knowledgeBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      temperature?: number
      top_p?: number
      max_tokens?: number
      messages: Array<{ content: string }>
    }
    expect(knowledgeBody.temperature).toBe(0)
    expect(knowledgeBody.top_p).toBeUndefined()
    expect(knowledgeBody.max_tokens).toBeUndefined()
    expect(knowledgeBody.messages[0]?.content).not.toContain('Imported Preset')
    expect(knowledgeBody.messages[1]?.content).toContain('ALPHA')
    expect(knowledgeBody.messages[1]?.content).not.toContain('BETA')

    const embeddingResult = await embedTextsWithOpenAICompatible('  ALPHA embedding text  ', {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'embedding-model',
    })
    expect(embeddingResult.embeddings).toEqual([[0.1, 0.2, 0.3]])

    const embeddingBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)) as {
      input: string
      temperature?: number
      top_p?: number
    }
    expect(embeddingBody.input).toBe('ALPHA embedding text')
    expect(embeddingBody.temperature).toBeUndefined()
    expect(embeddingBody.top_p).toBeUndefined()
  })

  it('expands macro-bearing bound presets into future-jump rewrite payloads and returns macro diagnostics metadata', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createMacroRuntimeLibrary(),
    }))

    const database = await createTestDatabase('chatbook-preset-compat-future-jump-macro-runtime')
    seedFutureJumpFixture(database)

    const bridgeSummary = '桥'.repeat(350)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: 'future text', titleHint: 'future title', subtitleHint: 'future subtitle' }) } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const service = await import('@/lib/server/future-jump-service')
    const result = await service.generateFutureJump({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      whatIfSessionId: 'what-if-001',
      targetOutlineNodeId: 'outline-100',
      targetOutlineChapterId: 'outline-anchor-100',
      userDirection: '让结果保持可预测。',
      presetCompatRuntimeContext: {
        namedTranscript: {
          kind: 'chat',
          userName: 'Alice',
          assistantName: 'Bob',
        },
        surfaceContextBlocks: [
          {
            id: 'named-transcript',
            label: 'Named Transcript',
            content: 'Alice: hello\nBob: hi',
            abstraction: 'named_transcript',
          },
        ],
      },
    })

    expect(result.presetCompat?.macroDiagnostics).toEqual([
      {
        code: 'UNSUPPORTED_MACRO',
        message: 'Macro is not supported on future_jump_rewrite: input',
        macroName: 'input',
        surfaceId: 'future_jump_rewrite',
        phase: 'apply-runtime',
      },
      {
        code: 'MISSING_CONTEXT_VALUE',
        message: 'Macro requires runtime context value: lastmessage',
        macroName: 'lastmessage',
        surfaceId: 'future_jump_rewrite',
        phase: 'apply-runtime',
      },
    ] satisfies PresetCompatMacroDiagnostic[])

    const bridgeBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(bridgeBody.messages[1]?.content).toContain('ALPHA')
    expect(bridgeBody.messages[1]?.content).not.toContain('Alice')
    expect(bridgeBody.messages[1]?.content).not.toContain('Bob')

    const rewriteBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(rewriteBody.messages[1]?.content).toContain('Future rewrite Alice -> Bob.')
    expect(rewriteBody.messages[1]?.content).not.toContain('{{user}}')
    expect(rewriteBody.messages[1]?.content).not.toContain('{{char}}')
    expect(rewriteBody.messages[1]?.content).not.toContain('{{input}}')
    expect(rewriteBody.messages[1]?.content).not.toContain('{{lastMessage}}')
  })
})
