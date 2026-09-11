import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildGenerationContext,
  type GenerationContextRagArtifacts,
  type GenerationContextRagCacheUsage,
  type GenerationContextRequest,
} from '@/lib/server/context-builder'
import { createDatabaseAccess, runWithDatabaseAccessScope } from '@/lib/server/database-access'
import {
  createGenerationContextSnapshot,
  loadGenerationContextSnapshot,
} from '@/lib/server/generation-context-snapshot'
import { buildChapterScopedGraphContext } from '@/lib/server/graph-context'
import { initializeDatabase } from '@/lib/server/sqlite'

const databases: DatabaseSync[] = []

function createFixture() {
  const database = initializeDatabase(new DatabaseSync(':memory:'))
  databases.push(database)
  const db = createDatabaseAccess(database)
  database.prepare('INSERT INTO NovelRecord (id, title) VALUES (?, ?)').run('novel-1', 'Novel')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-1:main', 'novel-1', 'main')
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-1', 'novel-1', 'novel-1:main', 1, 'Chapter 1', 'Chapter body', 'Chapter summary', 'source-hash-1', 'ready')
  return { database, db }
}

function insertEntity(database: DatabaseSync, id: string, name: string, entityType = 'character', importance = 3) {
  database.prepare(
    `INSERT INTO KnowledgeEntity (
      id, novelId, branchId, entityType, canonicalName, firstSeenChapter, lastSeenChapter,
      importanceTier, status, importance, userConfirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    'novel-1',
    'novel-1:main',
    entityType,
    name,
    1,
    1,
    entityType === 'character' ? 'important' : null,
    'active',
    importance,
    1,
  )
}

function buildRequest(overrides: Partial<GenerationContextRequest> = {}): GenerationContextRequest {
  return {
    novelId: 'novel-1',
    branchId: 'novel-1:main',
    chapterId: 'chapter-1',
    selectedText: '',
    operationType: 'rewrite',
    userInstruction: 'Continue the story',
    branchContextNodeId: 'continue-node-1',
    branchContextInclusion: 'include_selected',
    excludedGraphEdgeIds: [],
    excludedEvidenceIds: [],
    writingSkillCardIds: [],
    writingSkillExampleCount: 5,
    writingSkillSeed: 42,
    ...overrides,
  }
}

function buildArtifacts(): GenerationContextRagArtifacts {
  return {
    version: 1,
    graph: {
      cacheKey: 'graph-key',
      knowledgeFingerprint: 'graph-knowledge',
      context: {
        seedEntities: [],
        nodes: [],
        edges: [],
        contextText: '',
        warnings: [],
        tokenEstimate: 0,
        status: 'ready',
      },
    },
    evidence: {
      cacheKey: 'evidence-key',
      retrievalFingerprint: 'retrieval-knowledge',
      matches: [],
    },
  }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe('generation selection boundaries', () => {
  it('builds the neighborhood from the selected paragraphs past blank lines', async () => {
    const { database, db } = createFixture()
    insertEntity(database, 'opening-person', 'OpeningPerson')
    insertEntity(database, 'nearby-person', 'NearbyPerson')
    const sourceText = [
      'OpeningPerson waits.', '',
      ...Array.from({ length: 50 }, (_, index) => `Unrelated paragraph ${index}.`),
      'NearbyPerson arrives.', '', 'The letter opens.', 'Unselected ending.',
    ].join('\n')
    const result = await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest({
      sourceText,
      selectedText: 'NearbyPerson arrives.\n\nThe letter opens.',
      branchContextNodeId: undefined,
      userInstruction: 'Rewrite the selected passage',
    })))
    expect(result.selectedLineStart).toBe(53)
    expect(result.selectedLineEnd).toBe(55)
    const characters = result.promptBlocks.find((block) => block.id === 'characters')?.content
    expect(characters).toContain('NearbyPerson')
    expect(characters).not.toContain('OpeningPerson')
    const prefix = result.promptBlocks.find((block) => block.id === 'neighborhood')?.content
    expect(prefix).toContain('The letter opens.')
    expect(prefix).not.toContain('Unselected ending.')
  })
})

describe('chapter-scoped GraphRAG seeds', () => {
  it('reuses every resolved chapter character from EntityMention and EntityAppearance without a five/eight entity cap', async () => {
    const { database, db } = createFixture()
    for (let index = 1; index <= 10; index += 1) {
      insertEntity(database, `character-${index}`, `Character ${index}`, 'character', 20 - index)
    }
    insertEntity(database, 'character-appearance-only', 'Appearance-only Character', 'character', 2)
    insertEntity(database, 'location-1', 'Location 1', 'location', 5)

    const mention = database.prepare(
      `INSERT INTO EntityMention (
        id, novelId, branchId, chapterId, chapterNo, entityId, mentionText, resolutionKind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (let index = 1; index <= 10; index += 1) {
      mention.run(`mention-${index}`, 'novel-1', 'novel-1:main', 'chapter-1', 1, `character-${index}`, `Character ${index}`, 'resolved')
    }
    mention.run('mention-location', 'novel-1', 'novel-1:main', 'chapter-1', 1, 'location-1', 'Location 1', 'resolved')
    mention.run('mention-unresolved', 'novel-1', 'novel-1:main', 'chapter-1', 1, null, 'Unknown', 'unresolved')

    const appearance = database.prepare(
      'INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd) VALUES (?, ?, ?, ?, ?, ?)'
    )
    appearance.run('appearance-1a', 'character-1', 'chapter-1', 1, 1, 1)
    appearance.run('appearance-1b', 'character-1', 'chapter-1', 1, 8, 8)
    appearance.run('appearance-10', 'character-10', 'chapter-1', 1, 12, 12)
    appearance.run('appearance-only', 'character-appearance-only', 'chapter-1', 1, 15, 15)

    const result = await runWithDatabaseAccessScope(db, () => buildChapterScopedGraphContext({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      chapterId: 'chapter-1',
      chapterNo: 1,
      maxHops: 1,
    }))

    expect(result.seedEntities).toHaveLength(11)
    expect(new Set(result.seedEntities.map((entity) => entity.id))).toEqual(
      new Set([
        ...Array.from({ length: 10 }, (_, index) => `character-${index + 1}`),
        'character-appearance-only',
      ])
    )
    expect(result.seedEntities.some((entity) => entity.id === 'location-1')).toBe(false)
  })

  it('uses the chapter-scoped character set when building a Continue generation context', async () => {
    const { database, db } = createFixture()
    for (let index = 1; index <= 10; index += 1) {
      insertEntity(database, `character-${index}`, `Character ${index}`, 'character', 20 - index)
      database.prepare(
        `INSERT INTO EntityMention (
          id, novelId, branchId, chapterId, chapterNo, entityId, mentionText, resolutionKind
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `mention-${index}`,
        'novel-1',
        'novel-1:main',
        'chapter-1',
        1,
        `character-${index}`,
        `Character ${index}`,
        'resolved',
      )
    }

    const result = await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest()))

    expect(result.graphContext.seedEntities).toHaveLength(10)
    expect(new Set(result.graphContext.seedEntities.map((entity) => entity.id))).toEqual(
      new Set(Array.from({ length: 10 }, (_, index) => `character-${index + 1}`))
    )
    const charactersBlock = result.promptBlocks.find((block) => block.id === 'characters')
    expect(charactersBlock?.content.match(/^- Character /gm)).toHaveLength(10)
  })
})

describe('full-text chapter context blocks', () => {
  it('separates the current chapter through the selection from the five preceding full chapters', async () => {
    const { database, db } = createFixture()
    const insertChapter = database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (let chapterNo = 2; chapterNo <= 6; chapterNo += 1) {
      insertChapter.run(
        `chapter-${chapterNo}`,
        'novel-1',
        'novel-1:main',
        chapterNo,
        `Chapter ${chapterNo}`,
        `CHAPTER-${chapterNo}-START\nCHAPTER-${chapterNo}-MIDDLE\nCHAPTER-${chapterNo}-END`,
        `Summary ${chapterNo}`,
        `source-hash-${chapterNo}`,
        'ready',
      )
    }

    insertChapter.run(
      'chapter-7',
      'novel-1',
      'novel-1:main',
      7,
      'Chapter 7',
      '数据库中的旧正文',
      'Summary 7',
      'source-hash-7',
      'ready',
    )

    const currentSourceText = [
      '当前章开头。',
      '当前章中段，选中部分，选区之后同一行不应进入上下文。',
      '当前章结尾也不应进入上下文。',
    ].join('\n')
    const result = await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest({
      chapterId: 'chapter-7',
      selectedText: '选中部分',
      sourceText: currentSourceText,
      branchContextNodeId: undefined,
      branchContextInclusion: undefined,
    })))

    const selectionContext = result.promptBlocks.find((block) => block.id === 'neighborhood')
    expect(selectionContext).toMatchObject({
      label: '选区附近正文',
      priority: 'highest',
    })
    expect(selectionContext?.content).toContain('# 选区附近正文')
    expect(selectionContext?.content).not.toContain('范围：')
    expect(selectionContext?.content).toContain('当前章开头。')
    expect(selectionContext?.content).toContain('当前章中段，选中部分')
    expect(selectionContext?.content).not.toContain('选区之后同一行不应进入上下文')
    expect(selectionContext?.content).not.toContain('当前章结尾也不应进入上下文')

    const recentChapters = result.promptBlocks.find((block) => block.id === 'recent-chapters-full-text')
    expect(recentChapters).toMatchObject({
      label: '前情最近 5 章正文',
      priority: 'highest',
    })
    expect(recentChapters?.content.match(/^## 第 /gm)).toHaveLength(5)
    expect(recentChapters?.content).not.toContain('范围：')
    expect(recentChapters?.content).not.toContain('Chapter body')
    expect(recentChapters?.content).not.toContain('数据库中的旧正文')

    for (let chapterNo = 2; chapterNo <= 6; chapterNo += 1) {
      expect(recentChapters?.content).toContain(`## 第 ${chapterNo} 章 Chapter ${chapterNo}`)
      expect(recentChapters?.content).toContain(`CHAPTER-${chapterNo}-START`)
      expect(recentChapters?.content).toContain(`CHAPTER-${chapterNo}-END`)
    }

    expect(recentChapters?.content.indexOf('## 第 2 章')).toBeLessThan(recentChapters?.content.indexOf('## 第 6 章') ?? -1)
    expect(result.promptBlocks.indexOf(selectionContext!)).not.toBe(result.promptBlocks.indexOf(recentChapters!))
    expect(result.assembledContext).toContain(selectionContext?.content)
    expect(result.assembledContext).toContain(recentChapters?.content)
    expect(result.assembledContext).not.toContain('范围：')
  })
})

describe('generation context snapshots', () => {
  it('loads cached RAG artifacts for the same chapter even when prompt-only request inputs change', () => {
    const { db } = createFixture()
    const request = buildRequest()
    const artifacts = buildArtifacts()

    const snapshotId = runWithDatabaseAccessScope(db, () => createGenerationContextSnapshot({
      request,
      artifacts,
    }))
    expect(snapshotId).toBeTruthy()

    const reused = runWithDatabaseAccessScope(db, () => loadGenerationContextSnapshot({
      snapshotId,
      request: buildRequest({
        userInstruction: 'A different instruction',
        excludedGraphEdgeIds: ['edge-1'],
        excludedEvidenceIds: ['evidence-1'],
        writingSkillExampleCount: 2,
        writingSkillSeed: 99,
      }),
    }))
    expect(reused).toEqual(artifacts)
  })

  it('reuses both RAG layers when only exclusions or summaries change', async () => {
    const { database, db } = createFixture()
    insertEntity(database, 'character-a', 'Character A', 'character', 5)
    database.prepare(
      `INSERT INTO EntityMention (
        id, novelId, branchId, chapterId, chapterNo, entityId, mentionText, resolutionKind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('mention-a', 'novel-1', 'novel-1:main', 'chapter-1', 1, 'character-a', 'Character A', 'resolved')

    let firstArtifacts: GenerationContextRagArtifacts | null = null
    let firstUsage: GenerationContextRagCacheUsage | null = null
    await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest(), {
      onRagArtifacts: (artifacts, usage) => {
        firstArtifacts = artifacts
        firstUsage = usage
      },
    }))
    expect(firstUsage).toEqual({ graph: 'miss', evidence: 'miss' })
    expect(firstArtifacts).not.toBeNull()

    database.prepare('UPDATE KnowledgeChapter SET summary = ?, updatedAt = ? WHERE id = ?')
      .run('Edited summary', '2099-01-01 00:00:00', 'chapter-1')

    let secondUsage: GenerationContextRagCacheUsage | null = null
    const result = await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest({
      excludedGraphEdgeIds: ['edge-1'],
      excludedEvidenceIds: ['evidence-1'],
    }), {
      cachedRagArtifacts: firstArtifacts,
      onRagArtifacts: (_artifacts, usage) => {
        secondUsage = usage
      },
    }))

    expect(secondUsage).toEqual({ graph: 'hit', evidence: 'hit' })
    expect(result.promptBlocks.find((block) => block.id === 'current-summary')?.content).toContain('Edited summary')
  })

  it('reuses the chapter GraphRAG layer but refreshes vector evidence when the instruction changes', async () => {
    const { db } = createFixture()
    let firstArtifacts: GenerationContextRagArtifacts | null = null
    await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest(), {
      onRagArtifacts: (artifacts) => {
        firstArtifacts = artifacts
      },
    }))

    let usage: GenerationContextRagCacheUsage | null = null
    await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest({
      userInstruction: 'Focus on a different conflict',
    }), {
      cachedRagArtifacts: firstArtifacts,
      onRagArtifacts: (_artifacts, nextUsage) => {
        usage = nextUsage
      },
    }))

    expect(usage).toEqual({ graph: 'hit', evidence: 'miss' })
  })

  it('refreshes the graph layer after graph knowledge changes', async () => {
    const { database, db } = createFixture()
    insertEntity(database, 'character-a', 'Character A', 'character', 5)
    insertEntity(database, 'character-b', 'Character B', 'character', 4)
    database.prepare(
      `INSERT INTO EntityMention (
        id, novelId, branchId, chapterId, chapterNo, entityId, mentionText, resolutionKind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('mention-a', 'novel-1', 'novel-1:main', 'chapter-1', 1, 'character-a', 'Character A', 'resolved')
    database.prepare(
      `INSERT INTO EntityLink (
        id, novelId, branchId, sourceEntityId, targetEntityId, linkType, description,
        strength, sourceChapter, validFromChapter, validUntilChapter, confidence, status, includeByDefault
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'edge-1', 'novel-1', 'novel-1:main', 'character-a', 'character-b', 'ally', 'Original relation',
      3, 1, 1, 999999, 0.9, 'ai_generated', 1,
    )

    let firstArtifacts: GenerationContextRagArtifacts | null = null
    await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest(), {
      onRagArtifacts: (artifacts) => {
        firstArtifacts = artifacts
      },
    }))

    database.prepare('UPDATE EntityLink SET description = ?, updatedAt = ? WHERE id = ?')
      .run('Edited relation', '2099-01-01 00:00:00', 'edge-1')

    let usage: GenerationContextRagCacheUsage | null = null
    await runWithDatabaseAccessScope(db, () => buildGenerationContext(buildRequest(), {
      cachedRagArtifacts: firstArtifacts,
      onRagArtifacts: (_artifacts, nextUsage) => {
        usage = nextUsage
      },
    }))

    expect(usage).toEqual({ graph: 'miss', evidence: 'miss' })
  })
})
