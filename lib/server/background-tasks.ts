import type { KnowledgeJobType } from '@/lib/server/knowledge-rebuild'
import { abortRecoverableRewriteJob, RECOVERABLE_REWRITE_JOB_TYPE } from '@/lib/server/recoverable-rewrite-jobs'
import { execute, queryAll, queryOne } from '@/lib/server/sqlite'

const ACTIVE_BACKGROUND_TASK_STATUSES = ['queued', 'running', 'paused'] as const
const ACTIVE_BACKGROUND_TASK_JOB_TYPES = [
  'extract_chapter_knowledge',
  'rebuild_retrieval_index',
  RECOVERABLE_REWRITE_JOB_TYPE,
] as const

export type BackgroundTaskJobType = KnowledgeJobType | typeof RECOVERABLE_REWRITE_JOB_TYPE
export type BackgroundTaskStatus = typeof ACTIVE_BACKGROUND_TASK_STATUSES[number]

type SupportedBackgroundTaskStatus = BackgroundTaskStatus | 'succeeded' | 'failed' | 'aborted'

export type ActiveBackgroundTask = {
  jobId: string
  novelId: string
  novelTitle: string
  branchId: string | null
  jobType: BackgroundTaskJobType
  status: BackgroundTaskStatus
  progress: number
  currentStep: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

type ActiveBackgroundTaskRow = ActiveBackgroundTask

type BackgroundTaskRow = {
  jobId: string
  jobType: string
  status: SupportedBackgroundTaskStatus | string
}

export type AbortBackgroundTaskResult =
  | { ok: true; jobId: string; status: 'aborted'; outcome: 'aborted' }
  | { ok: false; statusCode: 400 | 404 | 409; error: string }

function isActiveBackgroundTaskStatus(status: string): status is BackgroundTaskStatus {
  return ACTIVE_BACKGROUND_TASK_STATUSES.includes(status as BackgroundTaskStatus)
}

function isSupportedBackgroundTaskJobType(jobType: string): jobType is BackgroundTaskJobType {
  return ACTIVE_BACKGROUND_TASK_JOB_TYPES.includes(jobType as BackgroundTaskJobType)
}

function persistAbortedBackgroundTask(jobId: string) {
  const result = execute(
    `UPDATE KnowledgeJob
     SET status = 'aborted', progress = 0, currentStep = ?, errorMessage = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN (?, ?, ?)`,
    '已中止',
    '已中止',
    jobId,
    ...ACTIVE_BACKGROUND_TASK_STATUSES,
  )
  return result.changes === 1
}

function resolveAbortAfterConcurrentChange(jobId: string): AbortBackgroundTaskResult {
  const row = queryOne<BackgroundTaskRow>(
    `SELECT id AS jobId, jobType, status
     FROM KnowledgeJob
     WHERE id = ?`,
    jobId,
  )

  if (!row) {
    return { ok: false, statusCode: 404, error: 'Background task not found' }
  }

  if (row.status === 'aborted') {
    return { ok: true, jobId, status: 'aborted', outcome: 'aborted' }
  }

  return { ok: false, statusCode: 409, error: `Background task in status ${row.status} cannot be aborted` }
}

export function listActiveBackgroundTasks() {
  const jobTypePlaceholders = ACTIVE_BACKGROUND_TASK_JOB_TYPES.map(() => '?').join(', ')
  const statusPlaceholders = ACTIVE_BACKGROUND_TASK_STATUSES.map(() => '?').join(', ')

  return queryAll<ActiveBackgroundTaskRow>(
    `
      SELECT
        job.id AS jobId,
        job.novelId AS novelId,
        novel.title AS novelTitle,
        job.branchId AS branchId,
        job.jobType AS jobType,
        job.status AS status,
        job.progress AS progress,
        job.currentStep AS currentStep,
        job.errorMessage AS errorMessage,
        job.createdAt AS createdAt,
        job.updatedAt AS updatedAt
      FROM KnowledgeJob job
      INNER JOIN NovelRecord novel ON novel.id = job.novelId
      WHERE job.jobType IN (${jobTypePlaceholders})
        AND job.status IN (${statusPlaceholders})
      ORDER BY job.updatedAt DESC, job.createdAt DESC
    `,
    ...ACTIVE_BACKGROUND_TASK_JOB_TYPES,
    ...ACTIVE_BACKGROUND_TASK_STATUSES,
  )
}

export function abortBackgroundTask(jobId: string): AbortBackgroundTaskResult {
  const normalizedJobId = jobId.trim()
  if (!normalizedJobId) {
    return { ok: false, statusCode: 400, error: 'jobId is required' }
  }

  const row = queryOne<BackgroundTaskRow>(
    `SELECT id AS jobId, jobType, status
     FROM KnowledgeJob
     WHERE id = ?`,
    normalizedJobId,
  )
  if (!row) {
    return { ok: false, statusCode: 404, error: 'Background task not found' }
  }

  if (!isSupportedBackgroundTaskJobType(row.jobType)) {
    return { ok: false, statusCode: 409, error: `Job type ${row.jobType} does not support abort` }
  }

  if (row.status === 'aborted') {
    return { ok: true, jobId: normalizedJobId, status: 'aborted', outcome: 'aborted' }
  }

  if (!isActiveBackgroundTaskStatus(row.status)) {
    return { ok: false, statusCode: 409, error: `Background task in status ${row.status} cannot be aborted` }
  }

  if (row.jobType === RECOVERABLE_REWRITE_JOB_TYPE) {
    abortRecoverableRewriteJob(normalizedJobId, '已中止')
    const rewrittenRow = queryOne<BackgroundTaskRow>(
      `SELECT id AS jobId, jobType, status
       FROM KnowledgeJob
       WHERE id = ?`,
      normalizedJobId,
    )
    if (rewrittenRow?.status !== 'aborted') {
      if (!persistAbortedBackgroundTask(normalizedJobId)) {
        return resolveAbortAfterConcurrentChange(normalizedJobId)
      }
    }
  } else {
    if (!persistAbortedBackgroundTask(normalizedJobId)) {
      return resolveAbortAfterConcurrentChange(normalizedJobId)
    }
  }

  return { ok: true, jobId: normalizedJobId, status: 'aborted', outcome: 'aborted' }
}
