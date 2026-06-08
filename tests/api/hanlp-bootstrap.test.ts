import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL
const LOCAL_HANLP_SMOKE_ENABLED = process.env.RETALE_RUN_LOCAL_HANLP_SMOKE === '1'

function resetGlobalSqlite() {
  const globalForSqlite = globalThis as { sqlite?: { close?: () => void } }
  globalForSqlite.sqlite?.close?.()
  delete globalForSqlite.sqlite
}

async function loadHanlpBootstrapModule(dbPath: string) {
  process.env.DATABASE_URL = `file:${dbPath}`
  resetGlobalSqlite()
  vi.resetModules()
  return import('@/lib/server/hanlp-bootstrap')
}

async function loadHanlpBootstrapInitializerModule(dbPath: string) {
  process.env.DATABASE_URL = `file:${dbPath}`
  resetGlobalSqlite()
  vi.resetModules()
  return import('@/lib/server/hanlp-bootstrap-initializer')
}

async function loadSqliteModule(dbPath: string) {
  process.env.DATABASE_URL = `file:${dbPath}`
  resetGlobalSqlite()
  vi.resetModules()
  return import('@/lib/server/sqlite')
}

function makeOutput() {
  return {
    people: [
      {
        text: '阿离',
        totalCount: 2,
        chapterCount: 1,
        coverageRatio: 1,
        score: 0.95,
        chapters: [{ chapterNo: 1, mentions: [{ startOffset: 0, endOffset: 2 }] }],
      },
    ],
    locations: [
      {
        text: '北京',
        totalCount: 1,
        chapterCount: 1,
        coverageRatio: 1,
        score: 0.4,
        chapters: [{ chapterNo: 1, mentions: [{ startOffset: 4, endOffset: 6 }] }],
      },
    ],
    organizations: [],
    settings: [],
  }
}

async function seedFixtureRows(dbPath: string, suffix: string) {
  const sqlite = await loadSqliteModule(dbPath)
  const novelId = `novel-hanlp-${suffix}`
  const branchId = `${novelId}:main`
  const chapterId = `chapter-1-${suffix}`
  sqlite.execute('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)', novelId, 'Fixture', 'txt')
  sqlite.execute('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)', branchId, novelId, 'main')
  sqlite.execute(
    'INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    chapterId,
    novelId,
    branchId,
    1,
    'Chapter 1',
    '阿离\n去北京',
    'source-hash-1',
  )

  return { novelId, branchId, chapterId }
}

async function seedAggregateEntityRows(dbPath: string, suffix: string) {
  const sqlite = await loadSqliteModule(dbPath)
  const novelId = `novel-hanlp-aggregate-${suffix}`
  const branchId = `${novelId}:main`

  sqlite.execute('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)', novelId, 'Aggregate Fixture', 'txt')
  sqlite.execute('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)', branchId, novelId, 'main')

  for (let chapterNo = 1; chapterNo <= 10; chapterNo += 1) {
    sqlite.execute(
      'INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `chapter-${suffix}-${chapterNo}`,
      novelId,
      branchId,
      chapterNo,
      `Chapter ${chapterNo}`,
      `第${chapterNo}章`,
      `source-hash-${suffix}-${chapterNo}`,
    )
  }

  const insertEntity = (name: string, entityType: string, chapterNo: number, totalCount: number, score: number) => {
    sqlite.execute(
      `
        INSERT INTO hanlp_bootstrap_entities (
          id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
          total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
      `hanlp-entity-${suffix}-${name}-${chapterNo}-${entityType}`,
      novelId,
      branchId,
      `chapter-${suffix}-${chapterNo}`,
      chapterNo,
      name,
      entityType,
      totalCount,
      1,
      0,
      score,
    )
  }

  for (let chapterNo = 1; chapterNo <= 10; chapterNo += 1) {
    insertEntity('阿离', 'person', chapterNo, 2, 0.95)
    insertEntity('守卫', 'person', chapterNo, 3, 0.91)
    insertEntity('北京', 'location', chapterNo, 1, 0.4)
  }

  for (let chapterNo = 1; chapterNo <= 9; chapterNo += 1) {
    insertEntity('洛川', 'person', chapterNo, 2, 0.7)
  }

  for (let chapterNo = 1; chapterNo <= 3; chapterNo += 1) {
    insertEntity('小满', 'person', chapterNo, 4, 0.6)
  }

  return { novelId, branchId }
}

afterEach(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL
  resetGlobalSqlite()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('hanlp bootstrap runner cache lifecycle', () => {
  it('stores a runner result once and reuses the cache on later matching calls', async () => {
    const tempDb = createTempDatabaseCopy('hanlp-bootstrap-cache')

    try {
      const ids = await seedFixtureRows(tempDb.dbPath, 'cache')
      const hanlp = await loadHanlpBootstrapModule(tempDb.dbPath)
      const runner = vi.fn()
        .mockResolvedValueOnce({ status: 0, stdout: JSON.stringify(makeOutput()), stderr: '', timedOut: false, error: null })
        .mockRejectedValueOnce(new Error('runner should not have been called on cache hit'))

      const first = await hanlp.runHanlpBootstrapForChapter(
        { novelId: ids.novelId, branchId: 'main', chapterId: ids.chapterId, chapterNo: 1, rawText: '阿离\n去北京' },
        { scriptPath: '/tmp/mock-hanlp.py', modelOrConfigIdentity: 'hanlp-local:v1', runner },
      )
      const second = await hanlp.runHanlpBootstrapForChapter(
        { novelId: ids.novelId, branchId: 'main', chapterId: ids.chapterId, chapterNo: 1, rawText: '阿离\n去北京' },
        { scriptPath: '/tmp/mock-hanlp.py', modelOrConfigIdentity: 'hanlp-local:v1', runner },
      )

      const sqlite = await loadSqliteModule(tempDb.dbPath)
      const cacheCount = sqlite.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', ids.branchId)
      const resultCount = sqlite.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_results WHERE branch_id = ?', ids.branchId)
      const entityCount = sqlite.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_entities WHERE branch_id = ?', ids.branchId)

      expect(first.source).toBe('runner')
      expect(second.source).toBe('cache')
      expect(first.output.entities.map((entity) => entity.text)).toEqual(['阿离', '北京'])
      expect(second.output.entities.map((entity) => entity.text)).toEqual(['阿离', '北京'])
      expect(runner).toHaveBeenCalledTimes(1)
      expect(cacheCount?.count).toBe(1)
      expect(resultCount?.count).toBe(1)
      expect(entityCount?.count).toBe(2)
    } finally {
      tempDb.cleanup()
    }
  })

  it('reruns HanLP when any cache key dimension changes', async () => {
    const tempDb = createTempDatabaseCopy('hanlp-bootstrap-miss')

    try {
      const ids = await seedFixtureRows(tempDb.dbPath, 'miss')
      const hanlp = await loadHanlpBootstrapModule(tempDb.dbPath)
      const runner = vi.fn().mockResolvedValue({
        status: 0,
        stdout: JSON.stringify(makeOutput()),
        stderr: '',
        timedOut: false,
        error: null,
      })

      const first = await hanlp.runHanlpBootstrapForChapter(
        { novelId: ids.novelId, branchId: 'main', chapterId: ids.chapterId, chapterNo: 1, rawText: '阿离\n去北京' },
        { scriptPath: '/tmp/mock-hanlp.py', modelOrConfigIdentity: 'hanlp-local:v1', runner },
      )
      const second = await hanlp.runHanlpBootstrapForChapter(
        { novelId: ids.novelId, branchId: 'main', chapterId: ids.chapterId, chapterNo: 1, rawText: '阿离\n去北京' },
        { scriptPath: '/tmp/mock-hanlp.py', modelOrConfigIdentity: 'hanlp-local:v2', runner },
      )

      const sqlite = await loadSqliteModule(tempDb.dbPath)
      const cacheCount = sqlite.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', ids.branchId)

      expect(first.source).toBe('runner')
      expect(second.source).toBe('runner')
      expect(first.cacheKey.hanlpModelOrConfigHash).not.toBe(second.cacheKey.hanlpModelOrConfigHash)
      expect(runner).toHaveBeenCalledTimes(2)
      expect(cacheCount?.count).toBe(2)
    } finally {
      tempDb.cleanup()
    }
  })

  it('fails clearly when HanLP is unavailable and no valid cache exists', async () => {
    const tempDb = createTempDatabaseCopy('hanlp-bootstrap-error')

    try {
      const ids = await seedFixtureRows(tempDb.dbPath, 'error')
      const hanlp = await loadHanlpBootstrapModule(tempDb.dbPath)

      await expect(hanlp.runHanlpBootstrapForChapter(
        { novelId: ids.novelId, branchId: 'main', chapterId: ids.chapterId, chapterNo: 1, rawText: '阿离\n去北京' },
        {
          scriptPath: '/tmp/mock-hanlp.py',
          runner: async () => {
            throw new Error('python3 not found')
          },
        },
      )).rejects.toThrow(/HanLP bootstrap could not start: python3 not found.*restore a valid cache/i)
    } finally {
      tempDb.cleanup()
    }
  })

  it('fails clearly on malformed JSON output when no cache exists', async () => {
    const tempDb = createTempDatabaseCopy('hanlp-bootstrap-malformed')

    try {
      const ids = await seedFixtureRows(tempDb.dbPath, 'malformed')
      const hanlp = await loadHanlpBootstrapModule(tempDb.dbPath)

      await expect(hanlp.runHanlpBootstrapForChapter(
        { novelId: ids.novelId, branchId: 'main', chapterId: ids.chapterId, chapterNo: 1, rawText: '阿离\n去北京' },
        {
          scriptPath: '/tmp/mock-hanlp.py',
          runner: async () => ({ status: 0, stdout: '{oops', stderr: '', timedOut: false, error: null }),
        },
      )).rejects.toThrow(/HanLP bootstrap emitted malformed JSON.*restore a valid cache/i)
    } finally {
      tempDb.cleanup()
    }
  })

  it('initializes formal character entities once, ignores temporary roles, and stays idempotent on rerun', async () => {
    const tempDb = createTempDatabaseCopy('hanlp-bootstrap-init')

    try {
      const ids = await seedAggregateEntityRows(tempDb.dbPath, 'init')
      const initializer = await loadHanlpBootstrapInitializerModule(tempDb.dbPath)

      const first = await initializer.initializeHanlpBootstrapCharacterEntities({
        novelId: ids.novelId,
        branchId: ids.branchId,
        configuredProtagonistName: '小满',
      })
      const second = await initializer.initializeHanlpBootstrapCharacterEntities({
        novelId: ids.novelId,
        branchId: ids.branchId,
        configuredProtagonistName: '小满',
      })

      const sqlite = await loadSqliteModule(tempDb.dbPath)
      const rows = sqlite.queryAll<{ canonicalName: string; importanceTier: string | null }>(
        `
          SELECT canonicalName, importanceTier
          FROM KnowledgeEntity
          WHERE branchId = ? AND entityType = 'character'
          ORDER BY canonicalName ASC
        `,
        ids.branchId,
      )

      expect(first.characterDecisions.find((item: { normalizedName: string }) => item.normalizedName === '守卫')).toMatchObject({ tier: 'ignored' })
      expect(first.promptContext.locations.map((item: { entityText: string }) => item.entityText)).toEqual(['北京'])
      expect(first.createdOrUpdatedEntityIds.length).toBe(3)
      expect(second.createdOrUpdatedEntityIds.length).toBe(3)
      expect(rows).toEqual([
        { canonicalName: '小满', importanceTier: 'protagonist' },
        { canonicalName: '洛川', importanceTier: 'important' },
        { canonicalName: '阿离', importanceTier: 'important' },
      ])
      expect(rows.some((row) => row.canonicalName === '守卫')).toBe(false)
    } finally {
      tempDb.cleanup()
    }
  })

  it('preserves stronger user-confirmed formal entities on bootstrap rerun', async () => {
    const tempDb = createTempDatabaseCopy('hanlp-bootstrap-preserve-confirmed')

    try {
      const ids = await seedAggregateEntityRows(tempDb.dbPath, 'preserve-confirmed')
      const sqlite = await loadSqliteModule(tempDb.dbPath)
      sqlite.execute(
        `
          INSERT INTO KnowledgeEntity (
            id, novelId, branchId, entityType, canonicalName, description,
            firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
          )
          VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, 1)
        `,
        'entity-confirmed-ali',
        ids.novelId,
        ids.branchId,
        '阿离',
        '阿离是用户确认过的核心人物。',
        1,
        3,
        'protagonist',
        'user_confirmed',
      )
      sqlite.execute(
        'INSERT INTO EntityAlias (id, entityId, alias, sourceChapter, confidence, userConfirmed) VALUES (?, ?, ?, ?, ?, ?)',
        'alias-confirmed-ali',
        'entity-confirmed-ali',
        '小阿离',
        1,
        1,
        1,
      )

      const initializer = await loadHanlpBootstrapInitializerModule(tempDb.dbPath)
      await initializer.initializeHanlpBootstrapCharacterEntities({
        novelId: ids.novelId,
        branchId: ids.branchId,
        configuredProtagonistName: '小满',
      })

      const verificationSqlite = await loadSqliteModule(tempDb.dbPath)
      const preserved = verificationSqlite.queryOne<{
        canonicalName: string
        description: string | null
        firstSeenChapter: number | null
        lastSeenChapter: number | null
        importanceTier: string | null
        status: string | null
        userConfirmed: number
      }>(
        `
          SELECT canonicalName, description, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
          FROM KnowledgeEntity
          WHERE id = ?
          LIMIT 1
        `,
        'entity-confirmed-ali',
      )

      expect(preserved).toMatchObject({
        canonicalName: '阿离',
        description: '阿离是用户确认过的核心人物。',
        firstSeenChapter: 1,
        lastSeenChapter: 10,
        importanceTier: 'protagonist',
        status: 'user_confirmed',
        userConfirmed: 1,
      })
    } finally {
      tempDb.cleanup()
    }
  })

  ;(LOCAL_HANLP_SMOKE_ENABLED ? it : it.skip)('runs a tiny local-only HanLP smoke when explicitly enabled and the script exists', async () => {
    const tempDb = createTempDatabaseCopy('hanlp-bootstrap-local-smoke')

    try {
      const ids = await seedFixtureRows(tempDb.dbPath, 'local-smoke')
      const hanlp = await loadHanlpBootstrapModule(tempDb.dbPath)
      const scriptPath = hanlp.resolveHanlpBootstrapScriptPath(process.env.HANLP_BOOTSTRAP_SCRIPT_PATH ?? null)

      if (!fs.existsSync(scriptPath)) {
        return
      }

      const result = await hanlp.runHanlpBootstrapForChapter(
        { novelId: ids.novelId, branchId: 'main', chapterId: ids.chapterId, chapterNo: 1, rawText: '阿离\n去北京' },
        { scriptPath, modelOrConfigIdentity: 'local-smoke' },
      )

      expect(result.normalizedChapterText).toBe('阿离\n去北京')
      expect(Array.isArray(result.output.entities)).toBe(true)
    } finally {
      tempDb.cleanup()
    }
  }, 30_000)
})
