import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL

async function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)

  process.env.DATABASE_URL = tempDatabase.dbPath
  vi.resetModules()

  const sqliteModule = await import('@/lib/server/sqlite')
  globalForSqlite.sqlite = sqliteModule.sqlite

  return { database: sqliteModule.sqlite }
}

async function loadTaskRoute() {
  return import('@/app/api/task/route')
}

function seedNovel(database: DatabaseSync, novelId: string, title = `Novel ${novelId}`) {
  const mainBranchId = `${novelId}:main`
  database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(novelId, title, 'workspace')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(mainBranchId, novelId, 'main')
  return { mainBranchId }
}

function insertJob(database: DatabaseSync, params: {
  id: string
  novelId: string
  branchId: string
  jobType: string
  status: string
  progress?: number
  currentStep?: string | null
  errorMessage?: string | null
  payloadJson?: string | null
  createdAtSql?: string
  updatedAtSql?: string
}) {
  database.prepare(
    `INSERT INTO KnowledgeJob (
      id, novelId, branchId, jobType, status, progress, currentStep, errorMessage, payloadJson, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${params.createdAtSql ?? "CURRENT_TIMESTAMP"}, ${params.updatedAtSql ?? "CURRENT_TIMESTAMP"})`
  ).run(
    params.id,
    params.novelId,
    params.branchId,
    params.jobType,
    params.status,
    params.progress ?? 0,
    params.currentStep ?? null,
    params.errorMessage ?? null,
    params.payloadJson ?? null,
  )
}

function createRewritePayload(novelId: string, branchId: string) {
  return JSON.stringify({
    request: {},
    panel: {
      novelId,
      branchId,
      chapterId: 'chapter-1',
      selectedText: '片段',
      sourceText: '正文',
      sourceTextOverride: null,
      userInstruction: '重写',
      rewriteLaunchSource: 'chapter',
      branchContextNodeId: null,
      branchContextInclusion: null,
      continueBlockId: null,
      createdAt: new Date().toISOString(),
    },
  })
}

function createAbortRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  process.env.DATABASE_URL = originalDatabaseUrl

  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }

  if (globalForSqlite.sqlite) {
    delete globalForSqlite.sqlite
  }

  vi.restoreAllMocks()
  vi.doUnmock('@/lib/server/sqlite')
  vi.doUnmock('@/lib/server/recoverable-rewrite-jobs')
  vi.resetModules()
})

describe('/api/task', () => {
  it('returns only supported active persisted jobs ordered by recency', async () => {
    const { database } = await createTestDatabase('chatbook-task-route')
    const { mainBranchId: novelOneBranchId } = seedNovel(database, 'novel-background-one', 'Background One')
    const { mainBranchId: novelTwoBranchId } = seedNovel(database, 'novel-background-two', 'Background Two')

    insertJob(database, {
      id: 'job_extract_running_visible',
      novelId: 'novel-background-one',
      branchId: novelOneBranchId,
      jobType: 'extract_chapter_knowledge',
      status: 'running',
      progress: 0.4,
      currentStep: 'extract',
      payloadJson: JSON.stringify({ steps: [] }),
      createdAtSql: "datetime('now', '-4 minutes')",
      updatedAtSql: "datetime('now', '-4 minutes')",
    })

    insertJob(database, {
      id: 'job_retrieval_paused_visible',
      novelId: 'novel-background-one',
      branchId: novelOneBranchId,
      jobType: 'rebuild_retrieval_index',
      status: 'paused',
      progress: 0.8,
      currentStep: 'index',
      payloadJson: JSON.stringify({ steps: [] }),
      createdAtSql: "datetime('now', '-3 minutes')",
      updatedAtSql: "datetime('now', '-3 minutes')",
    })

    insertJob(database, {
      id: 'job_rewrite_queued_visible',
      novelId: 'novel-background-two',
      branchId: novelTwoBranchId,
      jobType: 'rewrite_generation',
      status: 'queued',
      progress: 0.1,
      currentStep: '已创建可恢复魔改任务',
      payloadJson: createRewritePayload('novel-background-two', novelTwoBranchId),
      createdAtSql: "datetime('now', '-1 minutes')",
      updatedAtSql: "datetime('now', '-1 minutes')",
    })

    insertJob(database, {
      id: 'job_extract_succeeded_hidden',
      novelId: 'novel-background-one',
      branchId: novelOneBranchId,
      jobType: 'extract_chapter_knowledge',
      status: 'succeeded',
      progress: 1,
      currentStep: '完成',
      payloadJson: JSON.stringify({ steps: [] }),
      createdAtSql: "datetime('now', '-30 seconds')",
      updatedAtSql: "datetime('now', '-30 seconds')",
    })

    insertJob(database, {
      id: 'job_rewrite_aborted_hidden',
      novelId: 'novel-background-two',
      branchId: novelTwoBranchId,
      jobType: 'rewrite_generation',
      status: 'aborted',
      progress: 1,
      currentStep: '已中止',
      errorMessage: '已中止',
      payloadJson: createRewritePayload('novel-background-two', novelTwoBranchId),
      createdAtSql: "datetime('now', '-20 seconds')",
      updatedAtSql: "datetime('now', '-20 seconds')",
    })

    insertJob(database, {
      id: 'job_unsupported_running_hidden',
      novelId: 'novel-background-two',
      branchId: novelTwoBranchId,
      jobType: 'unsupported_job_type',
      status: 'running',
      progress: 0.5,
      currentStep: 'unsupported',
      payloadJson: JSON.stringify({}),
      createdAtSql: "datetime('now', '-10 seconds')",
      updatedAtSql: "datetime('now', '-10 seconds')",
    })

    const { GET, runtime } = await loadTaskRoute()
    const response = await GET()
    const payload = await response.json() as {
      ok: boolean
      count: number
      tasks: Array<{
        jobId: string
        novelId: string
        novelTitle: string
        branchId: string
        jobType: string
        status: string
        progress: number
        currentStep: string | null
        errorMessage: string | null
        createdAt: string
        updatedAt: string
      }>
    }

    expect(runtime).toBe('nodejs')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(payload.ok).toBe(true)
    expect(payload.count).toBe(3)
    expect(payload.tasks.map((task) => task.jobId)).toEqual([
      'job_rewrite_queued_visible',
      'job_retrieval_paused_visible',
      'job_extract_running_visible',
    ])
  })

  it('aborts an active knowledge extraction task', async () => {
    const { database } = await createTestDatabase('chatbook-task-abort-knowledge')
    const { mainBranchId } = seedNovel(database, 'novel-knowledge', 'Knowledge Novel')
    insertJob(database, {
      id: 'job_extract_abort',
      novelId: 'novel-knowledge',
      branchId: mainBranchId,
      jobType: 'extract_chapter_knowledge',
      status: 'running',
      progress: 0.55,
      currentStep: '提取中',
      payloadJson: JSON.stringify({ steps: [] }),
    })

    const { POST } = await loadTaskRoute()
    const response = await POST(createAbortRequest({ jobId: '  job_extract_abort  ' }))
    const payload = await response.json() as { ok: boolean; jobId: string; status: string; outcome: string }
    const row = database.prepare('SELECT status, progress, currentStep, errorMessage FROM KnowledgeJob WHERE id = ?').get('job_extract_abort') as {
      status: string
      progress: number
      currentStep: string | null
      errorMessage: string | null
    }

    expect(response.status).toBe(200)
    expect(payload).toEqual({ ok: true, jobId: 'job_extract_abort', status: 'aborted', outcome: 'aborted' })
    expect(row).toEqual({ status: 'aborted', progress: 0, currentStep: '已中止', errorMessage: '已中止' })
  })

  it('does not overwrite a task that becomes terminal during abort', async () => {
    const { database } = await createTestDatabase('chatbook-task-abort-race')
    const { mainBranchId } = seedNovel(database, 'novel-abort-race', 'Abort Race Novel')
    insertJob(database, {
      id: 'job_abort_race',
      novelId: 'novel-abort-race',
      branchId: mainBranchId,
      jobType: 'extract_chapter_knowledge',
      status: 'running',
      progress: 0.55,
      currentStep: '提取中',
      payloadJson: JSON.stringify({ steps: [] }),
    })

    const actualSqliteModule = await import('@/lib/server/sqlite')
    vi.doMock('@/lib/server/sqlite', () => ({
      ...actualSqliteModule,
      execute: vi.fn((sql: string, ...params: unknown[]) => {
        if (sql.includes("SET status = 'aborted'")) {
          database.prepare(
            "UPDATE KnowledgeJob SET status = 'succeeded', progress = 1, currentStep = '完成', updatedAt = CURRENT_TIMESTAMP WHERE id = ?"
          ).run('job_abort_race')
        }

        return actualSqliteModule.execute(sql, ...params as Parameters<typeof actualSqliteModule.execute>)
      }),
    }))

    const { POST } = await loadTaskRoute()
    const response = await POST(createAbortRequest({ jobId: 'job_abort_race' }))
    const row = database.prepare('SELECT status, progress, currentStep, errorMessage FROM KnowledgeJob WHERE id = ?').get('job_abort_race') as {
      status: string
      progress: number
      currentStep: string | null
      errorMessage: string | null
    }

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Background task in status succeeded cannot be aborted' })
    expect(row).toEqual({ status: 'succeeded', progress: 1, currentStep: '完成', errorMessage: null })
  })

  it('aborts an active retrieval rebuild task', async () => {
    const { database } = await createTestDatabase('chatbook-task-abort-retrieval')
    const { mainBranchId } = seedNovel(database, 'novel-retrieval', 'Retrieval Novel')
    insertJob(database, {
      id: 'job_retrieval_abort',
      novelId: 'novel-retrieval',
      branchId: mainBranchId,
      jobType: 'rebuild_retrieval_index',
      status: 'paused',
      progress: 0.75,
      currentStep: '索引中',
      payloadJson: JSON.stringify({ steps: [] }),
    })

    const { POST } = await loadTaskRoute()
    const response = await POST(createAbortRequest({ jobId: 'job_retrieval_abort' }))
    const row = database.prepare('SELECT status, progress, currentStep, errorMessage FROM KnowledgeJob WHERE id = ?').get('job_retrieval_abort') as {
      status: string
      progress: number
      currentStep: string | null
      errorMessage: string | null
    }

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, jobId: 'job_retrieval_abort', status: 'aborted', outcome: 'aborted' })
    expect(row).toEqual({ status: 'aborted', progress: 0, currentStep: '已中止', errorMessage: '已中止' })
  })

  it('aborts a rewrite task even when the recoverable helper returns null', async () => {
    const { database } = await createTestDatabase('chatbook-task-abort-rewrite')
    const { mainBranchId } = seedNovel(database, 'novel-rewrite', 'Rewrite Novel')
    insertJob(database, {
      id: 'job_rewrite_abort',
      novelId: 'novel-rewrite',
      branchId: mainBranchId,
      jobType: 'rewrite_generation',
      status: 'running',
      progress: 0.6,
      currentStep: '生成中',
      payloadJson: createRewritePayload('novel-rewrite', mainBranchId),
    })

    const abortRecoverableRewriteJob = vi.fn(() => null)
    vi.doMock('@/lib/server/recoverable-rewrite-jobs', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/recoverable-rewrite-jobs')>('@/lib/server/recoverable-rewrite-jobs')
      return {
        ...actual,
        abortRecoverableRewriteJob,
      }
    })

    const { POST } = await loadTaskRoute()
    const response = await POST(createAbortRequest({ jobId: 'job_rewrite_abort' }))
    const row = database.prepare('SELECT status, progress, currentStep, errorMessage FROM KnowledgeJob WHERE id = ?').get('job_rewrite_abort') as {
      status: string
      progress: number
      currentStep: string | null
      errorMessage: string | null
    }

    expect(response.status).toBe(200)
    expect(abortRecoverableRewriteJob).toHaveBeenCalledWith('job_rewrite_abort', '已中止')
    await expect(response.json()).resolves.toEqual({ ok: true, jobId: 'job_rewrite_abort', status: 'aborted', outcome: 'aborted' })
    expect(row).toEqual({ status: 'aborted', progress: 0, currentStep: '已中止', errorMessage: '已中止' })
  })

  it('rejects missing, unknown, unsupported, and terminal abort requests while keeping aborted idempotent', async () => {
    const { database } = await createTestDatabase('chatbook-task-abort-errors')
    const { mainBranchId } = seedNovel(database, 'novel-errors', 'Error Novel')
    insertJob(database, {
      id: 'job_unsupported_abort',
      novelId: 'novel-errors',
      branchId: mainBranchId,
      jobType: 'unsupported_job_type',
      status: 'running',
      payloadJson: JSON.stringify({}),
    })
    insertJob(database, {
      id: 'job_terminal_abort',
      novelId: 'novel-errors',
      branchId: mainBranchId,
      jobType: 'extract_chapter_knowledge',
      status: 'succeeded',
      progress: 1,
      currentStep: '完成',
      payloadJson: JSON.stringify({}),
    })
    insertJob(database, {
      id: 'job_already_aborted',
      novelId: 'novel-errors',
      branchId: mainBranchId,
      jobType: 'extract_chapter_knowledge',
      status: 'aborted',
      progress: 0,
      currentStep: '已中止',
      errorMessage: '已中止',
      payloadJson: JSON.stringify({}),
    })

    const { POST } = await loadTaskRoute()

    const missingResponse = await POST(createAbortRequest({ jobId: '   ' }))
    expect(missingResponse.status).toBe(400)
    await expect(missingResponse.json()).resolves.toEqual({ ok: false, error: 'jobId is required' })

    const unknownResponse = await POST(createAbortRequest({ jobId: 'job_missing_abort' }))
    expect(unknownResponse.status).toBe(404)
    await expect(unknownResponse.json()).resolves.toEqual({ ok: false, error: 'Background task not found' })

    const unsupportedResponse = await POST(createAbortRequest({ jobId: 'job_unsupported_abort' }))
    expect(unsupportedResponse.status).toBe(409)
    await expect(unsupportedResponse.json()).resolves.toEqual({ ok: false, error: 'Job type unsupported_job_type does not support abort' })

    const terminalResponse = await POST(createAbortRequest({ jobId: 'job_terminal_abort' }))
    expect(terminalResponse.status).toBe(409)
    await expect(terminalResponse.json()).resolves.toEqual({ ok: false, error: 'Background task in status succeeded cannot be aborted' })

    const abortedResponse = await POST(createAbortRequest({ jobId: 'job_already_aborted' }))
    expect(abortedResponse.status).toBe(200)
    await expect(abortedResponse.json()).resolves.toEqual({ ok: true, jobId: 'job_already_aborted', status: 'aborted', outcome: 'aborted' })
  })
})
