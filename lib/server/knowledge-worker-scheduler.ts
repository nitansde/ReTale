import { spawn } from 'node:child_process'
import path from 'node:path'
import { getNovelDb, getNovelLanceDbPath } from '@/lib/server/db-resolver'
import type { KnowledgeJobType } from '@/lib/server/knowledge-rebuild'
import { parseTaskWatchdogPayloadAttemptId } from '@/lib/server/task-watchdog-attempt'

type ScheduleKnowledgeWorkerParams = {
  novelId: string
  branchId: string
  jobId: string
  jobType: KnowledgeJobType
  attemptId?: string | null
  allowInTests?: boolean
}

const scheduledWorkerJobs = new Set<string>()

function readKnowledgeWorkerAttemptId(novelId: string, jobId: string) {
  const row = getNovelDb(novelId)
    .prepare('SELECT payloadJson FROM KnowledgeJob WHERE id = ?')
    .get(jobId) as { payloadJson: string | null } | undefined
  return parseTaskWatchdogPayloadAttemptId(row?.payloadJson ?? null)
}

function getNovelDbPath(novelId: string) {
  const database = getNovelDb(novelId)
  const row = database.prepare('PRAGMA database_list').get() as { file?: string } | undefined
  const filePath = row?.file?.trim()
  if (!filePath) {
    throw new Error(`Failed to resolve novel database path for knowledge worker: ${novelId}`)
  }

  return filePath
}

export function scheduleKnowledgeWorkerProcess(params: ScheduleKnowledgeWorkerParams) {
  const jobId = params.jobId.trim()
  const attemptId = params.attemptId === undefined ? readKnowledgeWorkerAttemptId(params.novelId, jobId) : params.attemptId
  const workerKey = `${params.jobType}:${jobId}:${attemptId ?? 'no-attempt'}`
  if (!jobId || scheduledWorkerJobs.has(workerKey) || (process.env.NODE_ENV === 'test' && !params.allowInTests)) {
    return false
  }

  const workerPath = path.join(process.cwd(), 'scripts', 'knowledge-worker.mjs')
  const novelDbPath = getNovelDbPath(params.novelId)
  const lanceDbPath = getNovelLanceDbPath(params.novelId)
  const child = spawn(process.execPath, [
    workerPath,
    '--job-id', jobId,
    '--job-type', params.jobType,
    '--novel-id', params.novelId,
    '--novel-db-path', novelDbPath,
    '--lance-db-path', lanceDbPath,
    '--branch-id', params.branchId,
  ], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      RETALE_KNOWLEDGE_WORKER: '1',
      RETALE_KNOWLEDGE_WORKER_NOVEL_ID: params.novelId,
      RETALE_KNOWLEDGE_WORKER_NOVEL_DB_PATH: novelDbPath,
      RETALE_KNOWLEDGE_WORKER_LANCEDB_DIR: lanceDbPath,
      DATABASE_URL: `file:${novelDbPath}`,
      LANCEDB_DIR: lanceDbPath,
    },
  })

  scheduledWorkerJobs.add(workerKey)
  child.once('exit', () => scheduledWorkerJobs.delete(workerKey))
  child.once('error', () => scheduledWorkerJobs.delete(workerKey))
  child.unref()
  return true
}

export function resetScheduledKnowledgeWorkerJobsForTesting() {
  scheduledWorkerJobs.clear()
}
