import type { DatabaseAccess, SqlParam } from '@/lib/server/database-access'

type KnowledgeJobColumn = 'status' | 'progress' | 'currentStep' | 'payloadJson' | 'errorMessage'

export type KnowledgeJobGuard = {
  jobType?: string
  statuses?: readonly string[]
  updatedAt?: string
  // A worker passes the attempt it was claimed under, so it cannot write onto a retried or aborted job.
  attemptId?: string | null
}

export function updateKnowledgeJobRow(
  db: Pick<DatabaseAccess, 'execute'>,
  jobId: string,
  fields: Partial<Record<KnowledgeJobColumn, SqlParam>>,
  guard: KnowledgeJobGuard = {},
) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  const where = ['id = ?']
  const whereParams: SqlParam[] = [jobId]
  if (guard.jobType) {
    where.push('jobType = ?')
    whereParams.push(guard.jobType)
  }
  if (guard.statuses) {
    where.push(`status IN (${guard.statuses.map(() => '?').join(', ')})`)
    whereParams.push(...guard.statuses)
  }
  if (guard.updatedAt) {
    where.push('updatedAt = ?')
    whereParams.push(guard.updatedAt)
  }
  if (guard.attemptId) {
    where.push(`json_extract(COALESCE(payloadJson, '{}'), '$.taskWatchdog.attemptId') = ?`)
    whereParams.push(guard.attemptId)
  }

  return db.execute(
    `UPDATE KnowledgeJob SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE ${where.join(' AND ')}`,
    ...entries.map(([, value]) => value ?? null),
    ...whereParams,
  )
}
