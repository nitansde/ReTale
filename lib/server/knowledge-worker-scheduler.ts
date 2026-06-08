import { spawn } from 'node:child_process'
import path from 'node:path'
import type { KnowledgeJobType } from '@/lib/server/knowledge-rebuild'
import { queryOne } from '@/lib/server/sqlite'
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

function readKnowledgeWorkerAttemptId(jobId: string) {
  const row = queryOne<{ payloadJson: string | null }>('SELECT payloadJson FROM KnowledgeJob WHERE id = ?', jobId)
  return parseTaskWatchdogPayloadAttemptId(row?.payloadJson ?? null)
}

export function scheduleKnowledgeWorkerProcess(params: ScheduleKnowledgeWorkerParams) {
  const jobId = params.jobId.trim()
  const attemptId = params.attemptId === undefined ? readKnowledgeWorkerAttemptId(jobId) : params.attemptId
  const workerKey = `${params.jobType}:${jobId}:${attemptId ?? 'no-attempt'}`
  if (!jobId || scheduledWorkerJobs.has(workerKey) || (process.env.NODE_ENV === 'test' && !params.allowInTests)) {
    return false
  }

  const workerPath = path.join(process.cwd(), 'scripts', 'knowledge-worker.mjs')
  const child = spawn(process.execPath, [
    workerPath,
    '--job-id', jobId,
    '--job-type', params.jobType,
    '--novel-id', params.novelId,
    '--branch-id', params.branchId,
  ], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CHATBOOK_KNOWLEDGE_WORKER: '1',
      DATABASE_URL: process.env.DATABASE_URL ?? 'file:./dev.db',
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
