import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createTempDatabaseCopy, hashFile } from '@/tests/helpers/temp-db'

const workerPath = path.join(process.cwd(), 'scripts', 'knowledge-worker.mjs')

function moveToPerNovelStorage(sourceDbPath: string, directory: string, novelId: string) {
  const novelDbPath = path.join(directory, 'data', 'novels', novelId, 'novel.db')
  fs.mkdirSync(path.dirname(novelDbPath), { recursive: true })
  fs.renameSync(sourceDbPath, novelDbPath)
  return novelDbPath
}

function seedKnowledgeJob(database: DatabaseSync, params: {
  novelId: string
  branchId: string
  jobId: string
  jobType?: 'extract_chapter_knowledge' | 'rebuild_retrieval_index'
  attemptId?: string
}) {
  database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)')
    .run(params.novelId, params.novelId, 'workspace')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)')
    .run(params.branchId, params.novelId, 'main')
  database.prepare(
    `INSERT INTO KnowledgeJob (
       id, novelId, branchId, jobType, status, currentStep, progress, payloadJson, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, 'queued', 'queued for worker test', 0, ?, ?, ?)`
  ).run(
    params.jobId,
    params.novelId,
    params.branchId,
    params.jobType ?? 'extract_chapter_knowledge',
    JSON.stringify({
      branchId: params.branchId,
      ...(params.attemptId === undefined ? {} : { taskWatchdog: { attemptId: params.attemptId } }),
    }),
    '2000-01-01 00:00:00',
    '2000-01-01 00:00:00',
  )
}

function runWorker(params: {
  cwd: string
  novelDbPath: string
  lanceDbPath: string
  novelId: string
  branchId: string
  jobId: string
  jobType?: 'extract_chapter_knowledge' | 'rebuild_retrieval_index'
  attemptId?: string
}) {
  return spawnSync(process.execPath, [
    workerPath,
    '--job-id', params.jobId,
    '--job-type', params.jobType ?? 'extract_chapter_knowledge',
    '--novel-id', params.novelId,
    '--novel-db-path', params.novelDbPath,
    '--lance-db-path', params.lanceDbPath,
    '--branch-id', params.branchId,
    ...(params.attemptId === undefined ? [] : ['--attempt-id', params.attemptId]),
  ], {
    cwd: params.cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      RETALE_KNOWLEDGE_WORKER: '1',
      RETALE_DATA_DIR: path.dirname(path.dirname(path.dirname(params.novelDbPath))),
    },
  })
}

type KnowledgeJobSnapshot = {
  status: string
  currentStep: string | null
  progress: number
  errorMessage: string | null
  payloadJson: string | null
  updatedAt: string
}

function readKnowledgeJobSnapshot(database: DatabaseSync, jobId: string) {
  return database.prepare(
    'SELECT status, currentStep, progress, errorMessage, payloadJson, updatedAt FROM KnowledgeJob WHERE id = ?'
  ).get(jobId) as KnowledgeJobSnapshot
}

describe('knowledge worker process bootstrap', () => {
  it('loads the repository TypeScript graph and claims a queued isolated job', () => {
    const tempDatabase = createTempDatabaseCopy('retale-knowledge-worker-process')
    const novelId = 'novel-worker-process'
    const branchId = `${novelId}:main`
    const jobId = 'job-worker-process'
    const novelDbPath = moveToPerNovelStorage(tempDatabase.dbPath, tempDatabase.directory, novelId)
    const database = new DatabaseSync(novelDbPath)
    seedKnowledgeJob(database, { novelId, branchId, jobId })
    database.prepare('UPDATE KnowledgeJob SET createdAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(jobId)
    database.close()

    try {
      const result = runWorker({
        cwd: process.cwd(),
        novelDbPath,
        lanceDbPath: path.join(tempDatabase.directory, 'lancedb'),
        novelId,
        branchId,
        jobId,
      })

      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')

      const readDatabase = new DatabaseSync(novelDbPath, { readOnly: true })
      const job = readDatabase.prepare(
        'SELECT status, errorMessage, payloadJson FROM KnowledgeJob WHERE id = ?'
      ).get(jobId) as { status: string; errorMessage: string | null; payloadJson: string | null }
      readDatabase.close()

      expect(['running', 'paused', 'succeeded', 'failed', 'aborted']).toContain(job.status)
      expect(job.status).toBe('succeeded')
      expect(job.errorMessage).toBeNull()
      expect(job.payloadJson).toContain('"attemptId":"task-attempt-')
    } finally {
      tempDatabase.cleanup()
    }
  })

  it.each([
    { label: 'main', jobType: 'extract_chapter_knowledge' as const },
    { label: 'retrieval', jobType: 'rebuild_retrieval_index' as const },
  ])('allows only the matching scheduled attempt to claim a tokenized $label job', ({ label, jobType }) => {
    const cases = [
      { label: 'matching', workerAttemptId: 'attempt-current', claimed: true },
      { label: 'stale', workerAttemptId: 'attempt-stale', claimed: false },
      { label: 'omitted', workerAttemptId: undefined, claimed: false },
    ] as const

    for (const workerCase of cases) {
      const tempDatabase = createTempDatabaseCopy(`retale-knowledge-worker-${label}-${workerCase.label}-attempt`)
      const novelId = `novel-worker-${label}-${workerCase.label}-attempt`
      const branchId = `${novelId}:main`
      const jobId = `job-worker-${label}-${workerCase.label}-attempt`
      const novelDbPath = moveToPerNovelStorage(tempDatabase.dbPath, tempDatabase.directory, novelId)
      const database = new DatabaseSync(novelDbPath)
      seedKnowledgeJob(database, {
        novelId,
        branchId,
        jobId,
        jobType,
        attemptId: 'attempt-current',
      })
      database.prepare('UPDATE KnowledgeJob SET createdAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(jobId)
      const before = readKnowledgeJobSnapshot(database, jobId)
      database.close()

      try {
        const result = runWorker({
          cwd: process.cwd(),
          novelDbPath,
          lanceDbPath: path.join(tempDatabase.directory, 'lancedb'),
          novelId,
          branchId,
          jobId,
          jobType,
          attemptId: workerCase.workerAttemptId,
        })

        expect(result.error).toBeUndefined()
        expect(result.status, result.stderr).toBe(0)

        const readDatabase = new DatabaseSync(novelDbPath, { readOnly: true })
        const after = readKnowledgeJobSnapshot(readDatabase, jobId)
        readDatabase.close()

        if (workerCase.claimed) {
          expect(after.status).toBe('succeeded')
          expect(after.errorMessage).toBeNull()
          expect(after.payloadJson).toContain('"attemptId":"attempt-current"')
          expect(after).not.toEqual(before)
        } else {
          expect(after).toEqual(before)
        }
      } finally {
        tempDatabase.cleanup()
      }
    }
  })

  it.each([
    { label: 'main', jobType: 'extract_chapter_knowledge' as const },
    { label: 'retrieval', jobType: 'rebuild_retrieval_index' as const },
  ])('does not claim a $label job with malformed payload JSON', ({ label, jobType }) => {
    const tempDatabase = createTempDatabaseCopy(`retale-knowledge-worker-${label}-malformed-payload`)
    const novelId = `novel-worker-${label}-malformed-payload`
    const branchId = `${novelId}:main`
    const jobId = `job-worker-${label}-malformed-payload`
    const novelDbPath = moveToPerNovelStorage(tempDatabase.dbPath, tempDatabase.directory, novelId)
    const database = new DatabaseSync(novelDbPath)
    seedKnowledgeJob(database, { novelId, branchId, jobId, jobType })
    database.prepare(
      'UPDATE KnowledgeJob SET payloadJson = ?, createdAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('{malformed', jobId)
    const before = readKnowledgeJobSnapshot(database, jobId)
    database.close()

    try {
      const result = runWorker({
        cwd: process.cwd(),
        novelDbPath,
        lanceDbPath: path.join(tempDatabase.directory, 'lancedb'),
        novelId,
        branchId,
        jobId,
        jobType,
        attemptId: 'attempt-current',
      })

      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)

      const readDatabase = new DatabaseSync(novelDbPath, { readOnly: true })
      const after = readKnowledgeJobSnapshot(readDatabase, jobId)
      readDatabase.close()
      expect(after).toEqual(before)
    } finally {
      tempDatabase.cleanup()
    }
  })

  it('fails only the exact queued matching attempt when application bootstrap cannot resolve from cwd', () => {
    const targetDatabase = createTempDatabaseCopy('retale-knowledge-worker-bootstrap-failure')
    const untouchedDatabase = createTempDatabaseCopy('retale-knowledge-worker-bootstrap-untouched')
    const novelId = 'novel-worker-bootstrap-failure'
    const branchId = `${novelId}:main`
    const jobId = 'job-worker-bootstrap-failure'
    const attemptId = 'attempt-worker-bootstrap-current'
    const otherNovelId = 'novel-worker-bootstrap-other'
    const otherBranchId = `${otherNovelId}:main`
    const invalidRepoRoot = path.join(targetDatabase.directory, 'invalid-repo-root')
    const novelDbPath = moveToPerNovelStorage(targetDatabase.dbPath, targetDatabase.directory, novelId)
    fs.mkdirSync(invalidRepoRoot)

    const database = new DatabaseSync(novelDbPath)
    seedKnowledgeJob(database, { novelId, branchId, jobId, attemptId })
    seedKnowledgeJob(database, {
      novelId: otherNovelId,
      branchId: otherBranchId,
      jobId: 'job-worker-bootstrap-other',
    })
    database.close()
    const untouchedHashBefore = hashFile(untouchedDatabase.dbPath)

    try {
      const result = runWorker({
        cwd: invalidRepoRoot,
        novelDbPath,
        lanceDbPath: path.join(targetDatabase.directory, 'lancedb'),
        novelId,
        branchId,
        jobId,
        attemptId,
      })

      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Cannot find package')

      const readDatabase = new DatabaseSync(novelDbPath, { readOnly: true })
      const targetJob = readDatabase.prepare(
        'SELECT status, errorMessage, updatedAt FROM KnowledgeJob WHERE id = ?'
      ).get(jobId) as { status: string; errorMessage: string | null; updatedAt: string }
      const otherJob = readDatabase.prepare(
        'SELECT status, errorMessage, updatedAt FROM KnowledgeJob WHERE id = ?'
      ).get('job-worker-bootstrap-other') as { status: string; errorMessage: string | null; updatedAt: string }
      readDatabase.close()

      expect(targetJob.status).toBe('failed')
      expect(targetJob.errorMessage).toContain('Knowledge worker startup failed')
      expect(targetJob.errorMessage).toContain('Cannot find package')
      expect(targetJob.errorMessage?.length).toBeLessThanOrEqual(2000)
      expect(targetJob.updatedAt).not.toBe('2000-01-01 00:00:00')
      expect(otherJob).toEqual({
        status: 'queued',
        errorMessage: null,
        updatedAt: '2000-01-01 00:00:00',
      })
      expect(hashFile(untouchedDatabase.dbPath)).toBe(untouchedHashBefore)
    } finally {
      targetDatabase.cleanup()
      untouchedDatabase.cleanup()
    }
  })

  it('does not let a stale startup failure overwrite a newer queued attempt', () => {
    const tempDatabase = createTempDatabaseCopy('retale-knowledge-worker-stale-startup-failure')
    const novelId = 'novel-worker-stale-startup-failure'
    const branchId = `${novelId}:main`
    const jobId = 'job-worker-stale-startup-failure'
    const invalidRepoRoot = path.join(tempDatabase.directory, 'invalid-repo-root')
    const novelDbPath = moveToPerNovelStorage(tempDatabase.dbPath, tempDatabase.directory, novelId)
    fs.mkdirSync(invalidRepoRoot)

    const database = new DatabaseSync(novelDbPath)
    seedKnowledgeJob(database, {
      novelId,
      branchId,
      jobId,
      attemptId: 'attempt-current',
    })
    database.close()

    try {
      const result = runWorker({
        cwd: invalidRepoRoot,
        novelDbPath,
        lanceDbPath: path.join(tempDatabase.directory, 'lancedb'),
        novelId,
        branchId,
        jobId,
        attemptId: 'attempt-stale',
      })

      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)

      const readDatabase = new DatabaseSync(novelDbPath, { readOnly: true })
      const job = readDatabase.prepare(
        'SELECT status, errorMessage, updatedAt, payloadJson FROM KnowledgeJob WHERE id = ?'
      ).get(jobId) as { status: string; errorMessage: string | null; updatedAt: string; payloadJson: string }
      readDatabase.close()

      expect(job.status).toBe('queued')
      expect(job.errorMessage).toBeNull()
      expect(job.updatedAt).toBe('2000-01-01 00:00:00')
      expect(job.payloadJson).toContain('"attemptId":"attempt-current"')
    } finally {
      tempDatabase.cleanup()
    }
  })

  it('does not let a tokenless startup failure overwrite a tokenized queued job', () => {
    const tempDatabase = createTempDatabaseCopy('retale-knowledge-worker-tokenless-startup-failure')
    const novelId = 'novel-worker-tokenless-startup-failure'
    const branchId = `${novelId}:main`
    const jobId = 'job-worker-tokenless-startup-failure'
    const invalidRepoRoot = path.join(tempDatabase.directory, 'invalid-repo-root')
    const novelDbPath = moveToPerNovelStorage(tempDatabase.dbPath, tempDatabase.directory, novelId)
    fs.mkdirSync(invalidRepoRoot)

    const database = new DatabaseSync(novelDbPath)
    seedKnowledgeJob(database, {
      novelId,
      branchId,
      jobId,
      attemptId: 'attempt-tokenized',
    })
    database.close()

    try {
      const result = runWorker({
        cwd: invalidRepoRoot,
        novelDbPath,
        lanceDbPath: path.join(tempDatabase.directory, 'lancedb'),
        novelId,
        branchId,
        jobId,
      })

      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)

      const readDatabase = new DatabaseSync(novelDbPath, { readOnly: true })
      const job = readDatabase.prepare(
        'SELECT status, errorMessage, updatedAt FROM KnowledgeJob WHERE id = ?'
      ).get(jobId) as { status: string; errorMessage: string | null; updatedAt: string }
      readDatabase.close()

      expect(job).toEqual({
        status: 'queued',
        errorMessage: null,
        updatedAt: '2000-01-01 00:00:00',
      })
    } finally {
      tempDatabase.cleanup()
    }
  })

  it('preserves tokenless startup-failure compatibility for tokenless queued jobs', () => {
    const tempDatabase = createTempDatabaseCopy('retale-knowledge-worker-tokenless-compatibility')
    const novelId = 'novel-worker-tokenless-compatibility'
    const branchId = `${novelId}:main`
    const jobId = 'job-worker-tokenless-compatibility'
    const invalidRepoRoot = path.join(tempDatabase.directory, 'invalid-repo-root')
    const novelDbPath = moveToPerNovelStorage(tempDatabase.dbPath, tempDatabase.directory, novelId)
    fs.mkdirSync(invalidRepoRoot)

    const database = new DatabaseSync(novelDbPath)
    seedKnowledgeJob(database, { novelId, branchId, jobId })
    database.close()

    try {
      const result = runWorker({
        cwd: invalidRepoRoot,
        novelDbPath,
        lanceDbPath: path.join(tempDatabase.directory, 'lancedb'),
        novelId,
        branchId,
        jobId,
      })

      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)

      const readDatabase = new DatabaseSync(novelDbPath, { readOnly: true })
      const job = readDatabase.prepare(
        'SELECT status, errorMessage FROM KnowledgeJob WHERE id = ?'
      ).get(jobId) as { status: string; errorMessage: string | null }
      readDatabase.close()

      expect(job.status).toBe('failed')
      expect(job.errorMessage).toContain('Knowledge worker startup failed')
    } finally {
      tempDatabase.cleanup()
    }
  })
})
