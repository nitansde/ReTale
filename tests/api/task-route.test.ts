import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerLegacyNovelDatabase, resetNovelDatabaseTestState } from '@/tests/helpers/novel-db'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const originalTaskStaleTimeoutMs = process.env.RETALE_TASK_STALE_TIMEOUT_MS
const originalTaskMaxRetries = process.env.RETALE_TASK_MAX_RETRIES

function createTestDatabase(prefix: string, novelIds: readonly string[]) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  const database = new DatabaseSync(tempDatabase.dbPath)
  const unregister = registerLegacyNovelDatabase(database, novelIds)
  cleanups.push(() => {
    unregister()
    database.close()
    tempDatabase.cleanup()
  })

  return { database }
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

function createTaskRequest(novelId: string) {
  return new Request(`http://localhost/api/task?novelId=${encodeURIComponent(novelId)}`)
}

afterEach(() => {
  process.env.RETALE_TASK_STALE_TIMEOUT_MS = originalTaskStaleTimeoutMs
  process.env.RETALE_TASK_MAX_RETRIES = originalTaskMaxRetries

  resetNovelDatabaseTestState()

  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }

  vi.restoreAllMocks()
  vi.doUnmock('@/lib/server/sqlite')
  vi.doUnmock('@/lib/server/recoverable-rewrite-jobs')
  vi.resetModules()
})

describe('/api/task', () => {
  it('returns only supported active persisted jobs ordered by recency', async () => {
    const { database } = createTestDatabase('retale-task-route-active', ['novel-background-one'])
    const { database: siblingDatabase } = createTestDatabase('retale-task-route-sibling', ['novel-background-two'])
    const { mainBranchId: novelOneBranchId } = seedNovel(database, 'novel-background-one', 'Background One')
    const { mainBranchId: novelTwoBranchId } = seedNovel(siblingDatabase, 'novel-background-two', 'Background Two')

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
      novelId: 'novel-background-one',
      branchId: novelOneBranchId,
      jobType: 'rewrite_generation',
      status: 'queued',
      progress: 0.1,
      currentStep: '已创建可恢复魔改任务',
      payloadJson: createRewritePayload('novel-background-one', novelOneBranchId),
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

    insertJob(siblingDatabase, {
      id: 'job_sibling_rewrite_queued_hidden',
      novelId: 'novel-background-two',
      branchId: novelTwoBranchId,
      jobType: 'rewrite_generation',
      status: 'queued',
      progress: 0.2,
      currentStep: '等待中',
      payloadJson: createRewritePayload('novel-background-two', novelTwoBranchId),
      createdAtSql: "datetime('now', '-5 seconds')",
      updatedAtSql: "datetime('now', '-5 seconds')",
    })

    insertJob(siblingDatabase, {
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

    insertJob(siblingDatabase, {
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
    const response = await GET(createTaskRequest('novel-background-one'))
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

  it('reconciles stale supported queued and running jobs before listing tasks', async () => {
    process.env.RETALE_TASK_STALE_TIMEOUT_MS = '1000'
    process.env.RETALE_TASK_MAX_RETRIES = '1'

    const { database } = createTestDatabase('retale-task-watchdog-list', ['novel-watchdog'])
    const { mainBranchId } = seedNovel(database, 'novel-watchdog', 'Watchdog Novel')

    insertJob(database, {
      id: 'job_stale_retry_extract',
      novelId: 'novel-watchdog',
      branchId: mainBranchId,
      jobType: 'extract_chapter_knowledge',
      status: 'running',
      progress: 0.45,
      currentStep: '抽取中',
      payloadJson: JSON.stringify({ steps: [] }),
      updatedAtSql: "datetime('now', '-10 seconds')",
      createdAtSql: "datetime('now', '-10 seconds')",
    })

    insertJob(database, {
      id: 'job_stale_fail_rewrite',
      novelId: 'novel-watchdog',
      branchId: mainBranchId,
      jobType: 'rewrite_generation',
      status: 'queued',
      progress: 0.1,
      currentStep: '等待中',
      payloadJson: JSON.stringify({
        request: {},
        panel: {
          novelId: 'novel-watchdog',
          branchId: mainBranchId,
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
        taskWatchdog: { attemptCount: 1 },
      }),
      updatedAtSql: "datetime('now', '-10 seconds')",
      createdAtSql: "datetime('now', '-10 seconds')",
    })

    const { GET } = await loadTaskRoute()
    const response = await GET(createTaskRequest('novel-watchdog'))
    const payload = await response.json() as {
      ok: boolean
      count: number
      tasks: Array<{ jobId: string; status: string; currentStep: string | null; errorMessage: string | null }>
    }

    const retriedRow = database.prepare(
      'SELECT status, currentStep, errorMessage, payloadJson FROM KnowledgeJob WHERE id = ?'
    ).get('job_stale_retry_extract') as { status: string; currentStep: string | null; errorMessage: string | null; payloadJson: string | null }
    const failedRow = database.prepare(
      'SELECT status, currentStep, errorMessage, payloadJson FROM KnowledgeJob WHERE id = ?'
    ).get('job_stale_fail_rewrite') as { status: string; currentStep: string | null; errorMessage: string | null; payloadJson: string | null }
    const retriedPayload = JSON.parse(retriedRow.payloadJson ?? '{}') as { taskWatchdog?: { attemptCount?: number; lastAction?: string } }
    const failedPayload = JSON.parse(failedRow.payloadJson ?? '{}') as { taskWatchdog?: { attemptCount?: number; lastAction?: string } }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.tasks.map((task) => task.jobId)).toEqual(['job_stale_retry_extract'])
    expect(payload.tasks[0]).toMatchObject({
      status: 'queued',
      currentStep: expect.stringContaining('progress.retry'),
      errorMessage: expect.stringContaining('无进度更新'),
    })
    expect(retriedRow).toMatchObject({
      status: 'queued',
      currentStep: expect.stringContaining('progress.retry'),
      errorMessage: expect.stringContaining('无进度更新'),
    })
    expect(retriedPayload.taskWatchdog).toMatchObject({ attemptCount: 1, lastAction: 'retried' })
    expect(failedRow).toMatchObject({
      status: 'failed',
      currentStep: expect.stringContaining('progress.retryExhausted'),
      errorMessage: expect.stringContaining('已标记失败'),
    })
    expect(failedPayload.taskWatchdog).toMatchObject({ attemptCount: 2, lastAction: 'failed' })
  })

  it('aborts an active knowledge extraction task', async () => {
    const { database } = createTestDatabase('retale-task-abort-knowledge', ['novel-knowledge'])
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
    const response = await POST(createAbortRequest({ jobId: '  job_extract_abort  ', novelId: 'novel-knowledge' }))
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
    const { database } = createTestDatabase('retale-task-abort-race', ['novel-abort-race'])
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

    database.exec(`
      CREATE TEMP TRIGGER complete_job_during_abort
      BEFORE UPDATE OF status ON KnowledgeJob
      WHEN OLD.id = 'job_abort_race' AND NEW.status = 'aborted'
      BEGIN
        UPDATE KnowledgeJob
        SET status = 'succeeded', progress = 1, currentStep = '完成', updatedAt = CURRENT_TIMESTAMP
        WHERE id = OLD.id;
        SELECT RAISE(IGNORE);
      END
    `)

    const { POST } = await loadTaskRoute()
    const response = await POST(createAbortRequest({ jobId: 'job_abort_race', novelId: 'novel-abort-race' }))
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
    const { database } = createTestDatabase('retale-task-abort-retrieval', ['novel-retrieval'])
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
    const response = await POST(createAbortRequest({ jobId: 'job_retrieval_abort', novelId: 'novel-retrieval' }))
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
    const { database } = createTestDatabase('retale-task-abort-rewrite', ['novel-rewrite'])
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
    const response = await POST(createAbortRequest({ jobId: 'job_rewrite_abort', novelId: 'novel-rewrite' }))
    const row = database.prepare('SELECT status, progress, currentStep, errorMessage FROM KnowledgeJob WHERE id = ?').get('job_rewrite_abort') as {
      status: string
      progress: number
      currentStep: string | null
      errorMessage: string | null
    }

    expect(response.status).toBe(200)
    expect(abortRecoverableRewriteJob).toHaveBeenCalledWith(
      'job_rewrite_abort',
      '已中止',
      expect.objectContaining({
        execute: expect.any(Function),
        queryAll: expect.any(Function),
        queryOne: expect.any(Function),
        withTransaction: expect.any(Function),
      }),
    )
    await expect(response.json()).resolves.toEqual({ ok: true, jobId: 'job_rewrite_abort', status: 'aborted', outcome: 'aborted' })
    expect(row).toEqual({ status: 'aborted', progress: 0, currentStep: '已中止', errorMessage: '已中止' })
  })

  it('rejects missing, unknown, unsupported, and terminal abort requests while keeping aborted idempotent', async () => {
    const { database } = createTestDatabase('retale-task-abort-errors', ['novel-errors'])
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

    const missingResponse = await POST(createAbortRequest({ jobId: '   ', novelId: 'novel-errors' }))
    expect(missingResponse.status).toBe(400)
    await expect(missingResponse.json()).resolves.toEqual({ ok: false, error: 'jobId is required' })

    const unknownResponse = await POST(createAbortRequest({ jobId: 'job_missing_abort', novelId: 'novel-errors' }))
    expect(unknownResponse.status).toBe(404)
    await expect(unknownResponse.json()).resolves.toEqual({ ok: false, error: 'Background task not found' })

    const unsupportedResponse = await POST(createAbortRequest({ jobId: 'job_unsupported_abort', novelId: 'novel-errors' }))
    expect(unsupportedResponse.status).toBe(409)
    await expect(unsupportedResponse.json()).resolves.toEqual({ ok: false, error: 'Job type unsupported_job_type does not support abort' })

    const terminalResponse = await POST(createAbortRequest({ jobId: 'job_terminal_abort', novelId: 'novel-errors' }))
    expect(terminalResponse.status).toBe(409)
    await expect(terminalResponse.json()).resolves.toEqual({ ok: false, error: 'Background task in status succeeded cannot be aborted' })

    const abortedResponse = await POST(createAbortRequest({ jobId: 'job_already_aborted', novelId: 'novel-errors' }))
    expect(abortedResponse.status).toBe(200)
    await expect(abortedResponse.json()).resolves.toEqual({ ok: true, jobId: 'job_already_aborted', status: 'aborted', outcome: 'aborted' })
  })
})
