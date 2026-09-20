import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('writing skill advanced-context preview', () => {
  it.each(['rewrite', 'roleplay'] as const)('returns one prompt block per selected skill card with the concrete selected examples for %s', async (operationType) => {
    const resolveWritingSkillRuntimes = vi.fn(() => ({
      runtimes: [],
      records: [],
      prompt: [
        '## 本次指定写作技巧：五官描写',
        '范文一：她抬起眼，眸光在雨幕中微微一顿。',
        '## 本次指定写作技巧：雨夜氛围',
        '范文一：檐角的水线被风吹斜，落在青石板上。',
      ].join('\n\n'),
      blocks: [
        {
          id: 'writing-skill:skill-facial-features',
          label: '写作技巧：五官描写',
          enabled: true,
          priority: 'highest' as const,
          content: [
            '## 本次指定写作技巧：五官描写',
            '### 参考范文',
            '范文一：',
            '她抬起眼，眸光在雨幕中微微一顿。',
          ].join('\n'),
        },
        {
          id: 'writing-skill:skill-rainy-night',
          label: '写作技巧：雨夜氛围',
          enabled: true,
          priority: 'highest' as const,
          content: [
            '## 本次指定写作技巧：雨夜氛围',
            '### 参考范文',
            '范文一：',
            '檐角的水线被风吹斜，落在青石板上。',
          ].join('\n'),
        },
      ],
    }))

    vi.doMock('@/lib/server/writing-skill-runtime', () => ({
      resolveWritingSkillRuntimes,
    }))
    vi.doMock('@/lib/server/graph-context', () => ({
      buildChapterScopedGraphContext: vi.fn(),
      buildGraphAwareContext: vi.fn(async () => ({
        seedEntities: [],
        nodes: [],
        edges: [],
        contextText: '',
        warnings: [],
        tokenEstimate: 0,
      })),
    }))
    vi.doMock('@/lib/server/authored-context', () => ({
      loadExplicitAuthoredContext: vi.fn(() => null),
    }))
    vi.doMock('@/lib/server/graph-store', () => ({
      loadEntityStatesByEntityIds: vi.fn(() => []),
    }))
    vi.doMock('@/lib/server/story-timeline-store', () => ({
      findStoryTimelineNodeById: vi.fn(() => null),
    }))
    vi.doMock('@/lib/server/knowledge-store', () => ({
      normalizeBranchId: vi.fn((novelId: string, branchId?: string) => branchId ?? `${novelId}:main`),
    }))
    vi.doMock('@/lib/utils', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/utils')>()),
      estimateTokenCount: vi.fn(() => 128),
    }))
    vi.doMock('@/lib/server/retrieval-index', () => ({
      searchLanceEvidence: vi.fn(async () => ({ matches: [], warning: null })),
    }))
    vi.doMock('@/lib/server/database-access', () => ({
      queryOne: vi.fn(() => ({
        id: 'chapter-1',
        chapterNo: 1,
        title: '第一章',
        rawText: '待改写原文',
        summary: '当前章节摘要。',
      })),
      queryAll: vi.fn((sql: string) => (
        sql.includes('FROM ChapterLine')
          ? [{ lineNo: 1, text: '待改写原文' }]
          : []
      )),
    }))

    const { buildGenerationContext } = await import('@/lib/server/context-builder')
    const result = await buildGenerationContext({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      chapterId: 'chapter-1',
      selectedText: '待改写原文',
      operationType,
      userInstruction: '增强人物和雨夜描写',
      writingSkillCardIds: ['skill-facial-features', 'skill-rainy-night'],
      writingSkillExampleCount: 1,
      writingSkillSeed: 73,
    })

    expect(resolveWritingSkillRuntimes).toHaveBeenCalledWith({
      cardIds: ['skill-facial-features', 'skill-rainy-night'],
      count: 1,
      seed: 73,
    })

    const writingSkillBlocks = result.promptBlocks.filter((block) => block.id.startsWith('writing-skill:'))
    expect(writingSkillBlocks).toHaveLength(2)
    expect(writingSkillBlocks.map((block) => block.id)).toEqual([
      'writing-skill:skill-facial-features',
      'writing-skill:skill-rainy-night',
    ])
    expect(writingSkillBlocks[0]?.content).toContain('她抬起眼，眸光在雨幕中微微一顿。')
    expect(writingSkillBlocks[1]?.content).toContain('檐角的水线被风吹斜，落在青石板上。')
    expect(result.assembledContext).toContain('她抬起眼，眸光在雨幕中微微一顿。')
    expect(result.assembledContext).toContain('檐角的水线被风吹斜，落在青石板上。')
  })
})
