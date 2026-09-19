import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseAccess, runWithDatabaseAccessScope } from '@/lib/server/database-access'
import { markKnowledgeStaleFromChapter } from '@/lib/server/knowledge-store'
import { buildKnowledgeProjection } from '@/lib/server/knowledge-view'
import { initializeDatabase } from '@/lib/server/sqlite'

vi.mock('@/lib/server/retrieval-index', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/retrieval-index')>(),
  deleteBranchRetrievalIndexFromChapter: vi.fn(async () => undefined),
}))

let database: DatabaseSync
afterEach(() => database?.close())

function seedDatabase() {
  database = initializeDatabase(new DatabaseSync(':memory:'))
  database.prepare("INSERT INTO NovelRecord (id, title) VALUES ('novel', 'Re0 regression')").run()
  for (const branchId of ['novel:main', 'novel:alt']) {
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(branchId, 'novel', branchId)
  }
  for (const id of ['hero', 'friend']) {
    database.prepare(`INSERT INTO KnowledgeEntity
      (id, novelId, branchId, entityType, canonicalName, importanceTier, firstSeenChapter)
      VALUES (?, 'novel', 'novel:main', 'character', ?, 'important', 1)`).run(id, id)
  }
  for (const chapterNo of [2, 8, 9, 10]) {
    database.prepare(`INSERT INTO KnowledgeChapter
      (id, novelId, branchId, chapterNo, title, rawText, sourceHash, knowledgeStatus, isDirty)
      VALUES (?, 'novel', 'novel:main', ?, ?, 'original text', 'hash', 'ready', 0)`)
      .run(`chapter-${chapterNo}`, chapterNo, `Chapter ${chapterNo}`)
  }
  return createDatabaseAccess(database)
}

const artifactTables = ['KnowledgeFact', 'KnowledgeRelation', 'EntityLink', 'EntityState', 'KnowledgeWorld', 'KnowledgeEvent', 'EventLink'] as const

function seedArtifacts(id: string, chapter: number, status = 'ai_generated', branchId = 'novel:main', validUntilChapter = 2147483647) {
  const profile = { identity: { content: '异世界的来客' }, personality: { content: '勇敢' }, capability: { content: '阴属性魔法' } }
  database.prepare(`INSERT INTO KnowledgeFact
    (id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter, status)
    VALUES (?, 'novel', ?, 'character_profile', 'hero', 'role_card', ?, ?, ?, ?, ?)`)
    .run(id, branchId, JSON.stringify({ profile }), chapter, chapter, validUntilChapter, status)
  database.prepare(`INSERT INTO KnowledgeRelation
    (id, novelId, branchId, sourceEntityId, targetEntityId, relationType, sourceChapter, validFromChapter, validUntilChapter, status)
    VALUES (?, 'novel', ?, 'hero', 'friend', '朋友', ?, ?, ?, ?)`)
    .run(id, branchId, chapter, chapter, validUntilChapter, status)
  database.prepare(`INSERT INTO EntityLink
    (id, novelId, branchId, sourceEntityId, targetEntityId, linkType, sourceChapter, validFromChapter, validUntilChapter, status)
    VALUES (?, 'novel', ?, 'hero', 'friend', 'relation', ?, ?, ?, ?)`)
    .run(id, branchId, chapter, chapter, validUntilChapter, status)
  database.prepare(`INSERT INTO EntityState
    (id, novelId, branchId, entityId, stateType, stateValue, sourceChapter, validFromChapter, validUntilChapter, status)
    VALUES (?, 'novel', ?, 'hero', 'character_status', '登场', ?, ?, ?, ?)`)
    .run(id, branchId, chapter, chapter, validUntilChapter, status)
  database.prepare(`INSERT INTO KnowledgeWorld
    (id, novelId, branchId, term, definition, firstSeenChapter, validFromChapter, validUntilChapter, status)
    VALUES (?, 'novel', ?, ?, '已构建的设定', ?, ?, ?, ?)`)
    .run(id, branchId, id, chapter, chapter, validUntilChapter, status)
  database.prepare(`INSERT INTO KnowledgeEvent
    (id, novelId, branchId, name, summary, chapterNo, status)
    VALUES (?, 'novel', ?, ?, '已构建的事件', ?, ?)`)
    .run(id, branchId, id, chapter, status)
  database.prepare(`INSERT INTO EventLink
    (id, novelId, branchId, sourceEventId, targetEventId, linkType, sourceChapter, validFromChapter, status)
    VALUES (?, 'novel', ?, ?, ?, 'causes', ?, ?, ?)`)
    .run(id, branchId, id, id, chapter, chapter, status)
}

function statuses(id: string) {
  return Object.fromEntries(artifactTables.map((table) => [table,
    (database.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id) as { status: string }).status,
  ]))
}

describe('knowledge invalidation chapter boundaries', () => {
  it('keeps earlier character cards and knowledge visible after a later chapter changes', async () => {
    const db = seedDatabase()
    seedArtifacts('earlier', 2)
    seedArtifacts('boundary', 9)
    seedArtifacts('later', 10)

    await runWithDatabaseAccessScope(db, async () => {
      const before = await buildKnowledgeProjection(['novel'], 8, { includeKnowledgeStatusOverview: false })
      expect(before.localCharacters.find((character) => character.id === 'hero')?.goal).toBe('阴属性魔法')

      await markKnowledgeStaleFromChapter({ novelId: 'novel', branchId: 'novel:main', fromChapterNo: 9, db })

      const after = await buildKnowledgeProjection(['novel'], 8, { includeKnowledgeStatusOverview: false })
      expect(after.localCharacters).toEqual(before.localCharacters)
      expect(after.localWorldEntries).toEqual(before.localWorldEntries)
      expect(after.localCharacterRelations).toEqual(before.localCharacterRelations)
      expect(statuses('earlier')).toEqual(Object.fromEntries(artifactTables.map((table) => [table, 'ai_generated'])))
      for (const id of ['boundary', 'later']) {
        expect(statuses(id)).toEqual({
          KnowledgeFact: 'outdated', KnowledgeRelation: 'outdated', KnowledgeWorld: 'outdated', KnowledgeEvent: 'outdated',
          EntityLink: 'potentially_stale', EntityState: 'potentially_stale', EventLink: 'potentially_stale',
        })
      }
      expect(db.queryAll('SELECT chapterNo, isDirty, knowledgeStatus FROM KnowledgeChapter ORDER BY chapterNo')).toEqual([
        { chapterNo: 2, isDirty: 0, knowledgeStatus: 'ready' },
        { chapterNo: 8, isDirty: 0, knowledgeStatus: 'ready' },
        { chapterNo: 9, isDirty: 1, knowledgeStatus: 'stale' },
        { chapterNo: 10, isDirty: 1, knowledgeStatus: 'stale' },
      ])
    })
  })

  it('invalidates by origin even for closed intervals while preserving confirmed knowledge and other branches', async () => {
    const db = seedDatabase()
    seedArtifacts('closed', 9, 'ai_generated', 'novel:main', 9)
    seedArtifacts('confirmed', 10, 'user_confirmed')
    seedArtifacts('other-branch', 10, 'ai_generated', 'novel:alt')
    // An earlier relation can be updated by a later chapter without changing its start.
    seedArtifacts('later-source', 2)
    for (const table of ['KnowledgeFact', 'KnowledgeRelation', 'EntityState', 'EntityLink']) {
      database.prepare(`UPDATE ${table} SET sourceChapter = 10 WHERE id = 'later-source'`).run()
    }

    await markKnowledgeStaleFromChapter({ novelId: 'novel', branchId: 'novel:main', fromChapterNo: 9, db })

    expect(statuses('confirmed')).toEqual(Object.fromEntries(artifactTables.map((table) => [table, 'user_confirmed'])))
    expect(statuses('other-branch')).toEqual(Object.fromEntries(artifactTables.map((table) => [table, 'ai_generated'])))
    expect(statuses('closed').KnowledgeFact).toBe('outdated')
    expect(statuses('closed').KnowledgeWorld).toBe('outdated')
    expect(statuses('closed').EntityState).toBe('potentially_stale')
    expect(statuses('later-source')).toMatchObject({
      KnowledgeFact: 'outdated', KnowledgeRelation: 'outdated', EntityLink: 'potentially_stale', EntityState: 'potentially_stale',
    })
  })
})
