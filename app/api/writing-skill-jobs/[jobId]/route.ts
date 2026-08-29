import { jsonError, noStoreJson } from '@/lib/server/api-route'
import { scheduleWritingSkillDistillationJob } from '@/lib/server/writing-skill-background'
import { resolveWritingSkillCardDetail } from '@/lib/server/writing-skill-runtime'
import {
  cancelWritingSkillJob,
  readWritingSkillJob,
} from '@/lib/server/writing-skill-store'

type Context = { params: Promise<{ jobId: string }> }

function serializeJob(job: NonNullable<ReturnType<typeof readWritingSkillJob>>) {
  return {
    ...job,
    card: job.resultCardId ? resolveWritingSkillCardDetail({ cardId: job.resultCardId }) : null,
  }
}

export async function GET(_request: Request, context: Context) {
  const { jobId } = await context.params
  const job = readWritingSkillJob(jobId)
  if (!job) return jsonError('写作技巧任务不存在', 404)
  if (job.status === 'PENDING') scheduleWritingSkillDistillationJob(job.id)
  return noStoreJson({ ok: true, job: serializeJob(job) })
}

export async function DELETE(_request: Request, context: Context) {
  const { jobId } = await context.params
  const job = cancelWritingSkillJob(jobId)
  if (!job) return jsonError('写作技巧任务不存在', 404)
  return noStoreJson({ ok: true, job: serializeJob(job) })
}
