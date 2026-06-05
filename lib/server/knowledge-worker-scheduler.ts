import { spawn } from 'node:child_process'
import path from 'node:path'
import type { KnowledgeJobType } from '@/lib/server/knowledge-rebuild'

type ScheduleKnowledgeWorkerParams = {
  novelId: string
  branchId: string
  jobId: string
  jobType: KnowledgeJobType
}

const scheduledWorkerJobs = new Set<string>()

export function scheduleKnowledgeWorkerProcess(params: ScheduleKnowledgeWorkerParams) {
  const jobId = params.jobId.trim()
  const workerKey = `${params.jobType}:${jobId}`
  if (!jobId || scheduledWorkerJobs.has(workerKey) || process.env.NODE_ENV === 'test') {
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
