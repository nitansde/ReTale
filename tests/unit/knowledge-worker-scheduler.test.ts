import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

class MockChildProcess extends EventEmitter {
  unrefInvoked = false

  unref() {
    this.unrefInvoked = true
    return this
  }
}

const originalDataDir = process.env.RETALE_DATA_DIR
const cleanupDirectories: string[] = []

function restoreEnvVar(name: 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

function canonicalizePath(targetPath: string) {
  if (!fs.existsSync(targetPath)) {
    return path.resolve(targetPath)
  }

  return fs.realpathSync.native(targetPath)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)
  delete process.env.DATABASE_URL
  while (cleanupDirectories.length) {
    fs.rmSync(cleanupDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('knowledge worker scheduler', () => {
  it('allows retry scheduling for the same job id when the attempt id changes', async () => {
    const tempDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-knowledge-worker-scheduler-'))
    cleanupDirectories.push(tempDataRoot)
    process.env.RETALE_DATA_DIR = path.join(tempDataRoot, 'data')
    const childProcesses: MockChildProcess[] = []
    const spawnMock = vi.fn(() => {
      const child = new MockChildProcess()
      childProcesses.push(child)
      return child
    })
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    const scheduler = await import('@/lib/server/knowledge-worker-scheduler')
    scheduler.resetScheduledKnowledgeWorkerJobsForTesting()

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      jobId: 'job-1',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-1',
      allowInTests: true,
    })).toBe(true)

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      jobId: 'job-1',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-1',
      allowInTests: true,
    })).toBe(false)

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      jobId: 'job-1',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-2',
      allowInTests: true,
    })).toBe(true)

    expect(spawnMock).toHaveBeenCalledTimes(2)
    const firstWorkerPath = path.join(process.cwd(), 'scripts', 'knowledge-worker.mjs')
    const firstSpawnArgs = spawnMock.mock.calls[0]?.[1]
    const firstSpawnOptions = spawnMock.mock.calls[0]?.[2]
    const expectedNovelDbPath = canonicalizePath(path.join(tempDataRoot, 'data', 'novels', 'novel-1', 'novel.db'))
    const expectedLanceDbPath = canonicalizePath(path.join(tempDataRoot, 'data', 'novels', 'novel-1', 'lancedb'))

    expect(spawnMock.mock.calls[0]?.[0]).toBe(process.execPath)
    expect(firstSpawnArgs).toEqual([
      firstWorkerPath,
      '--job-id', 'job-1',
      '--job-type', 'extract_chapter_knowledge',
      '--novel-id', 'novel-1',
      '--novel-db-path', expectedNovelDbPath,
      '--lance-db-path', expectedLanceDbPath,
      '--branch-id', 'novel-1:main',
      '--attempt-id', 'attempt-1',
    ])
    expect(firstSpawnOptions?.cwd).toBe(process.cwd())
    expect(firstSpawnOptions?.detached).toBe(true)
    expect(firstSpawnOptions?.stdio).toBe('ignore')
    expect(childProcesses[0]?.unrefInvoked).toBe(true)
    expect(childProcesses[1]?.unrefInvoked).toBe(true)
    expect(firstSpawnOptions?.env?.RETALE_KNOWLEDGE_WORKER).toBe('1')
    expect(firstSpawnOptions?.env?.RETALE_KNOWLEDGE_WORKER_NOVEL_ID).toBe('novel-1')
    expect(canonicalizePath(String(firstSpawnOptions?.env?.RETALE_KNOWLEDGE_WORKER_NOVEL_DB_PATH))).toBe(canonicalizePath(expectedNovelDbPath))
    expect(canonicalizePath(String(firstSpawnOptions?.env?.RETALE_KNOWLEDGE_WORKER_LANCEDB_DIR))).toBe(canonicalizePath(expectedLanceDbPath))
    expect(canonicalizePath(String(firstSpawnOptions?.env?.DATABASE_URL).replace(/^file:/u, ''))).toBe(canonicalizePath(expectedNovelDbPath))
    expect(canonicalizePath(String(firstSpawnOptions?.env?.LANCEDB_DIR))).toBe(canonicalizePath(expectedLanceDbPath))
  })

  it('reads omitted attempt ids from the target novel DB instead of singleton state', async () => {
    const tempDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-knowledge-worker-scheduler-'))
    cleanupDirectories.push(tempDataRoot)
    process.env.RETALE_DATA_DIR = path.join(tempDataRoot, 'data')

    const singletonDbPath = path.join(tempDataRoot, 'singleton.db')
    process.env.DATABASE_URL = singletonDbPath

    const spawnMock = vi.fn(() => new MockChildProcess())
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    const sqliteModule = await import('@/lib/server/sqlite')
    const resolverModule = await import('@/lib/server/db-resolver')
    const scheduler = await import('@/lib/server/knowledge-worker-scheduler')

    scheduler.resetScheduledKnowledgeWorkerJobsForTesting()

    sqliteModule.sqlite.prepare(
      `INSERT INTO NovelRecord (id, title, sourceType)
       VALUES (?, ?, ?)`
    ).run('singleton-novel', 'Singleton', 'workspace')
    sqliteModule.sqlite.prepare(
      `INSERT INTO StoryBranch (id, novelId, name)
       VALUES (?, ?, ?)`
    ).run('singleton-novel:main', 'singleton-novel', 'main')
    sqliteModule.sqlite.prepare(
      `INSERT INTO KnowledgeJob (
        id, novelId, branchId, jobType, status, payloadJson
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'job-shared',
      'singleton-novel',
      'singleton-novel:main',
      'extract_chapter_knowledge',
      'queued',
      JSON.stringify({ taskWatchdog: { attemptId: 'singleton-attempt' } }),
    )

    const alphaDb = resolverModule.getNovelDb('novel-alpha')
    alphaDb.prepare(
      `INSERT INTO NovelRecord (id, title, sourceType)
       VALUES (?, ?, ?)`
    ).run('novel-alpha', 'Alpha', 'workspace')
    alphaDb.prepare(
      `INSERT INTO StoryBranch (id, novelId, name)
       VALUES (?, ?, ?)`
    ).run('novel-alpha:main', 'novel-alpha', 'main')
    const upsertAlphaJob = alphaDb.prepare(
      `INSERT INTO KnowledgeJob (
        id, novelId, branchId, jobType, status, payloadJson
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payloadJson = excluded.payloadJson,
        updatedAt = CURRENT_TIMESTAMP`
    )

    upsertAlphaJob.run(
      'job-shared',
      'novel-alpha',
      'novel-alpha:main',
      'extract_chapter_knowledge',
      'queued',
      JSON.stringify({ taskWatchdog: { attemptId: 'alpha-attempt-1' } }),
    )

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-alpha',
      branchId: 'novel-alpha:main',
      jobId: 'job-shared',
      jobType: 'extract_chapter_knowledge',
      allowInTests: true,
    })).toBe(true)

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-alpha',
      branchId: 'novel-alpha:main',
      jobId: 'job-shared',
      jobType: 'extract_chapter_knowledge',
      allowInTests: true,
    })).toBe(false)

    upsertAlphaJob.run(
      'job-shared',
      'novel-alpha',
      'novel-alpha:main',
      'extract_chapter_knowledge',
      'queued',
      JSON.stringify({ taskWatchdog: { attemptId: 'alpha-attempt-2' } }),
    )

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-alpha',
      branchId: 'novel-alpha:main',
      jobId: 'job-shared',
      jobType: 'extract_chapter_knowledge',
      allowInTests: true,
    })).toBe(true)

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0]?.[1]?.slice(-2)).toEqual(['--attempt-id', 'alpha-attempt-1'])
    expect(spawnMock.mock.calls[1]?.[1]?.slice(-2)).toEqual(['--attempt-id', 'alpha-attempt-2'])
    expect(spawnMock.mock.calls[0]?.[2]?.env?.RETALE_KNOWLEDGE_WORKER_NOVEL_ID).toBe('novel-alpha')
    expect(canonicalizePath(String(spawnMock.mock.calls[0]?.[2]?.env?.DATABASE_URL).replace(/^file:/u, ''))).toBe(
      canonicalizePath(path.join(tempDataRoot, 'data', 'novels', 'novel-alpha', 'novel.db'))
    )
  })

  it('omits the attempt argument when the resolved attempt id is null', async () => {
    const tempDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-knowledge-worker-scheduler-tokenless-'))
    cleanupDirectories.push(tempDataRoot)
    process.env.RETALE_DATA_DIR = path.join(tempDataRoot, 'data')
    const spawnMock = vi.fn(() => new MockChildProcess())
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    const scheduler = await import('@/lib/server/knowledge-worker-scheduler')
    scheduler.resetScheduledKnowledgeWorkerJobsForTesting()

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-tokenless',
      branchId: 'novel-tokenless:main',
      jobId: 'job-tokenless',
      jobType: 'extract_chapter_knowledge',
      attemptId: null,
      allowInTests: true,
    })).toBe(true)

    const workerArgs = spawnMock.mock.calls[0]?.[1]
    expect(workerArgs).toEqual([
      path.join(process.cwd(), 'scripts', 'knowledge-worker.mjs'),
      '--job-id', 'job-tokenless',
      '--job-type', 'extract_chapter_knowledge',
      '--novel-id', 'novel-tokenless',
      '--novel-db-path', canonicalizePath(path.join(tempDataRoot, 'data', 'novels', 'novel-tokenless', 'novel.db')),
      '--lance-db-path', canonicalizePath(path.join(tempDataRoot, 'data', 'novels', 'novel-tokenless', 'lancedb')),
      '--branch-id', 'novel-tokenless:main',
    ])
    expect(workerArgs).not.toContain('--attempt-id')
  })

  it('refuses to spawn workers for deleting and deleted registry rows', async () => {
    const tempDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-knowledge-worker-scheduler-fence-'))
    cleanupDirectories.push(tempDataRoot)
    process.env.RETALE_DATA_DIR = path.join(tempDataRoot, 'data')
    const spawnMock = vi.fn(() => new MockChildProcess())
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    const resolver = await import('@/lib/server/db-resolver')
    const novelDb = resolver.getNovelDb('novel-fenced')
    const novelDbPath = (novelDb.prepare('PRAGMA database_list').get() as { file: string }).file
    const controlDb = resolver.getControlDb()
    controlDb.prepare(
      `INSERT INTO NovelRegistry (
         novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
       ) VALUES (?, ?, ?, ?, ?, '1', ?)`,
    ).run(
      'novel-fenced',
      'novel-fenced',
      'Fenced',
      novelDbPath,
      path.join(path.dirname(novelDbPath), 'lancedb'),
      'deleting',
    )
    const scheduler = await import('@/lib/server/knowledge-worker-scheduler')

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-fenced',
      branchId: 'novel-fenced:main',
      jobId: 'job-fenced',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-1',
      allowInTests: true,
    })).toBe(false)

    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', 'novel-fenced')
    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-fenced',
      branchId: 'novel-fenced:main',
      jobId: 'job-fenced',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-2',
      allowInTests: true,
    })).toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
