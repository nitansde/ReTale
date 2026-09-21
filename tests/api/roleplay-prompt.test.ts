import { afterEach, describe, expect, it, vi } from 'vitest'

function createRoleplayHistoryContent(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
  return [
    '# 当前角色扮演对话',
    ...messages.map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`),
  ].join('\n')
}

function createRoleplayOutputConstraintsText() {
  return [
    '- 输出由 narration（旁白）、player（我方台词）、counterpart（对方台词）组成的 JSON 脚本块。',
    '- 承接用户的开场台词，允许继续编写双方多轮对话及行动旁白；篇幅接近本次目标字数即可，以自然收尾为先。',
    '- 保持与已有角色扮演历史连续。',
    '- 人物块可以包含该角色的台词、神态、语气和动作描写；连续旁白段落合并为一块，不跨过对话合并。不要输出剧情大纲或格式说明。',
    '- 不要自动应用、改写或续写 chapter 正文。',
    '- 不要输出分析。',
    '- 不要输出 Markdown 标题。',
    '- 不要使用当前章节之后的事实。',
  ].join('\n')
}

function createRoleplayRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId: 'novel-roleplay',
      chapterId: 'chapter-roleplay',
      sourceText: '原始章节片段',
      selectedText: '选中的锚点片段',
      userInstruction: '继续对话',
      operationType: 'roleplay',
      mode: 'dialogue',
      tone: 'dramatic',
      scope: 'chapter',
      stream: false,
      ...body,
    }),
  })
}

async function importContextBuilderHelpers() {
  vi.doMock('@/lib/server/graph-context', () => ({
    buildChapterScopedGraphContext: vi.fn(),
    buildGraphAwareContext: vi.fn(),
  }))
  vi.doMock('@/lib/server/authored-context', () => ({
    loadExplicitAuthoredContext: vi.fn(),
  }))
  vi.doMock('@/lib/server/graph-store', () => ({
    loadEntityStatesByEntityIds: vi.fn(),
  }))
  vi.doMock('@/lib/server/story-timeline-store', () => ({
    findStoryTimelineNodeById: vi.fn(),
  }))
  vi.doMock('@/lib/server/knowledge-store', () => ({
    normalizeBranchId: vi.fn(),
  }))
  vi.doMock('@/lib/utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/utils')>()),
    estimateTokenCount: vi.fn(() => 0),
  }))
  vi.doMock('@/lib/server/retrieval-index', () => ({
    searchLanceEvidence: vi.fn(),
  }))
  vi.doMock('@/lib/server/database-access', () => ({
    execute: vi.fn(),
    queryAll: vi.fn(),
    queryOne: vi.fn(),
    withTransaction: vi.fn(),
    createNovelDatabaseAccess: vi.fn(),
    runWithNovelDatabaseAccess: vi.fn((_novelId: string, callback: () => unknown) => callback()),
  }))

  return import('@/lib/server/context-builder')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('roleplay prompt contract', () => {
  it('keeps the full selected roleplay history in order beyond six turns', async () => {
    const { buildRoleplayContextBlock, normalizeRoleplayContextMessages } = await importContextBuilderHelpers()

    const normalized = normalizeRoleplayContextMessages([
      { role: 'user', content: '  第一轮  ' },
      { role: 'assistant', content: '第二轮' },
      { role: 'user', content: '   ' },
      { role: 'assistant', content: '第三轮' },
    ])

    expect(normalized).toEqual([
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: '第二轮' },
      { role: 'assistant', content: '第三轮' },
    ])

    const bounded = normalizeRoleplayContextMessages(
      Array.from({ length: 14 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `消息 ${index + 1}`,
      })),
    )

    expect(bounded).toHaveLength(14)
    expect(bounded[0]).toEqual({ role: 'user', content: '消息 1' })
    expect(bounded.at(-1)).toEqual({ role: 'assistant', content: '消息 14' })

    const history = buildRoleplayContextBlock(bounded)!.content
    expect(history).toContain('## 1. 用户输入\n消息 1')
    expect(history).toContain('## 14. 已发生的故事\n消息 14')
    expect(history.indexOf('消息 1')).toBeLessThan(history.indexOf('消息 14'))
  })

  it('uses roleplay-only non-mutating constraints and keeps rewrite and future-jump contracts unchanged', async () => {
    const { formatOutputConstraints } = await importContextBuilderHelpers()

    expect(formatOutputConstraints('roleplay')).toBe([
      '- 输出由 narration（旁白）、player（我方台词）、counterpart（对方台词）组成的 JSON 脚本块。',
      '- 承接用户的开场台词，允许继续编写双方多轮对话及行动旁白；篇幅接近本次目标字数即可，以自然收尾为先。',
      '- 保持与已有角色扮演历史连续。',
      '- 人物块可以包含该角色的台词、神态、语气和动作描写；连续旁白段落合并为一块，不跨过对话合并。不要输出剧情大纲或格式说明。',
      '- 不要自动应用、改写或续写 chapter 正文。',
      '- 不要输出分析。',
      '- 不要输出 Markdown 标题。',
      '- 不要使用当前章节之后的事实。',
    ].join('\n'))

    expect(formatOutputConstraints('rewrite')).toBe([
      '- 只输出小说正文。',
      '- 不要输出分析。',
      '- 不要输出 Markdown 标题。',
      '- 保持原文叙事视角。',
      '- 不要使用当前章节之后的事实。',
      '- 如果是魔改/重写：允许改变当前片段走向，但要保持前文一致。',
    ].join('\n'))

    expect(formatOutputConstraints('future_jump')).toBe([
      '- 只输出小说正文。',
      '- 不要输出分析。',
      '- 不要输出 Markdown 标题。',
      '- 保持原文叙事视角。',
      '- 不要使用当前章节之后的事实。',
      '- 如果是未来跳转：允许朝目标未来推进，但要保持已知上下文自洽。',
    ].join('\n'))
  })

  it('passes ordered normalized roleplay history into the route prompt and never touches workspace draft persistence', async () => {
    const rawRoleplayMessages: unknown[] = [
      { role: 'user', content: '  你昨晚为什么没有回来？  ' },
      { role: 'assistant', content: '我被风暴困在了渡口。' },
      { role: 'system', content: '这条消息不该进入 roleplay 历史。' },
      { role: 'user', content: '   ' },
      null,
      { role: 'user', content: '那你现在还想骗我吗？' },
    ]
    const normalizedRoleplayMessages = [
      { role: 'user' as const, content: '你昨晚为什么没有回来？' },
      { role: 'assistant' as const, content: '我被风暴困在了渡口。' },
      { role: 'user' as const, content: '那你现在还想骗我吗？' },
    ]

    const workspaceWriteSpy = vi.fn()
    const buildGenerationContext = vi.fn(async (input: { roleplayMessages?: Array<{ role: 'user' | 'assistant'; content: string }> }) => ({
      novelId: 'novel-roleplay',
      branchId: 'novel-roleplay:main',
      chapterId: 'chapter-roleplay',
      chapterNo: 7,
      selectedLineStart: 12,
      selectedLineEnd: 13,
      warnings: [],
      promptBlocks: [
        {
          id: 'roleplay-history',
          label: '当前角色扮演对话',
          enabled: true,
          priority: 'highest' as const,
          content: createRoleplayHistoryContent(input.roleplayMessages ?? []),
        },
        {
          id: 'output-constraints',
          label: '输出要求',
          enabled: true,
          priority: 'high' as const,
          content: ['# 输出要求', createRoleplayOutputConstraintsText()].join('\n'),
        },
      ],
      assembledContext: '',
      graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
      lanceEvidence: [],
      tokenEstimate: 0,
    }))
    const generateRewriteWithOpenAICompatible = vi.fn(async (input: { userPrompt: string }) => ({
      enabled: true,
      content: ['当然想，但这次我只会把真相告诉你。'],
      usage: { inputTokens: 11, outputTokens: 9 },
      capturedPrompt: input.userPrompt,
    }))

    vi.doMock('@/lib/server/persistence', () => ({
      upsertWorkspaceState: workspaceWriteSpy,
      createWorkspaceState: workspaceWriteSpy,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext,
    }))
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: {
            baseUrl: 'https://example.test/v1',
            apiKey: 'test-key',
            model: 'test-model',
          },
          ollama: {
            baseUrl: 'http://127.0.0.1:11434',
            model: 'ignored',
          },
        },
      }),
    }))
    vi.doMock('@/lib/preset-compat/apply-runtime', () => ({
      applyPresetCompatCreativeRuntime: (params: { userPrompt: string; systemPrompt: string }) => ({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        metadata: {},
        hasActiveOutputRegex: false,
        applyOutputRuntime: (value: string) => ({ value }),
        resolvedRuntime: {
          providerRuntime: {
            provider: 'openai-compatible',
            config: { model: 'test-model' },
            request: {},
          },
        },
      }),
    }))
    vi.doMock('@/lib/preset-compat/runtime-integration', () => ({
      resolveCreativeRoutePresetCompatMetadata: () => ({
        fieldStatuses: [],
        contextWindow: null,
        streamPolicy: { effective: false },
        metadata: {},
      }),
      serializePresetCompatResponseMetadata: () => 'test-header',
    }))
    vi.doMock('@/lib/server/openai-compatible', () => ({
      generateRewriteWithOpenAICompatible,
      streamRewriteWithOpenAICompatible: vi.fn(),
    }))
    vi.doMock('@/lib/server/ollama-local', () => ({
      generateRewriteWithOllama: vi.fn(),
      streamRewriteWithOllama: vi.fn(),
    }))
    vi.doMock('@/lib/server/llm-debug-log', () => ({
      writeLlmDebugLog: vi.fn(),
    }))

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRoleplayRequest({ roleplayMessages: rawRoleplayMessages }))

    expect(response.status).toBe(200)
    expect(buildGenerationContext).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'roleplay',
      roleplayMessages: normalizedRoleplayMessages,
    }), { cachedRagArtifacts: null, writingSkillBundle: null })
    expect(generateRewriteWithOpenAICompatible).toHaveBeenCalledTimes(1)
    expect(workspaceWriteSpy).not.toHaveBeenCalled()

    const rewriteInput = generateRewriteWithOpenAICompatible.mock.calls[0]?.[0] as { userPrompt: string }
    expect(rewriteInput.userPrompt).toContain('# 当前角色扮演对话')
    expect(rewriteInput.userPrompt).toContain('## 1. 用户输入\n你昨晚为什么没有回来？')
    expect(rewriteInput.userPrompt).toContain('## 2. 已发生的故事\n我被风暴困在了渡口。')
    expect(rewriteInput.userPrompt).toContain('## 3. 用户输入\n那你现在还想骗我吗？')
    expect(rewriteInput.userPrompt).not.toContain('这条消息不该进入 roleplay 历史。')
    expect(rewriteInput.userPrompt).toContain('# 角色扮演回复契约')
    expect(rewriteInput.userPrompt).toContain('只回复当前这一轮的聊天内容。')
    expect(rewriteInput.userPrompt).toContain('不要自动应用、改写或续写 chapter 正文。')
    expect(rewriteInput.userPrompt).toMatch(/^# 输出要求$/m)
    expect(rewriteInput.userPrompt).not.toContain('只输出小说正文。')

    const scriptTurn = { playerName: '林舟', counterpartName: '沈月', storyGuidance: '雨夜，两人在窗边。', dialogue: '你相信我吗？', maxCharacters: 300 }
    const scriptResponse = await POST(createRoleplayRequest({ roleplayTurn: scriptTurn }))
    expect(scriptResponse.status).toBe(200)
    const scriptInput = generateRewriteWithOpenAICompatible.mock.calls[1]?.[0] as { userPrompt: string; systemPrompt?: string }
    expect(scriptInput.userPrompt).toContain('# 双角色互动输出要求')
    expect(scriptInput.userPrompt).not.toMatch(/^# 输出要求$/m)
    expect(scriptInput.userPrompt).toContain('不要输出剧情大纲或格式说明。不要自动应用、改写或续写原章节正文。')
    expect(scriptInput.userPrompt).toContain('目标字数约为 300 字')
    expect(scriptInput.userPrompt).toContain('双方多轮对话和旁白')
    expect(scriptInput.userPrompt).toContain('林舟')
    expect(scriptInput.userPrompt).toContain('沈月')
    expect(scriptInput.userPrompt).not.toContain('只回复当前这一轮的聊天内容')
    expect(scriptInput.systemPrompt).toContain('你负责生成双角色互动内容')
    const invalidResponse = await POST(createRoleplayRequest({ roleplayTurn: { ...scriptTurn, maxCharacters: 0 } }))
    expect(invalidResponse.status).toBe(400)

    await expect(response.json()).resolves.toMatchObject({
      provider: 'openai-compatible',
      candidates: [
        expect.objectContaining({ content: '当然想，但这次我只会把真相告诉你。' }),
      ],
    })
  })
})
