import { NextResponse } from 'next/server'
import { jsonError, readJsonObject } from '@/lib/server/api-route'
import { scheduleWritingSkillDistillationJob } from '@/lib/server/writing-skill-background'
import { createWritingSkillRandomSeed } from '@/lib/server/writing-skill-distillation-agent'
import {
  createWritingSkillJob,
  listWritingSkillCardSources,
  readWritingSkillCard,
} from '@/lib/server/writing-skill-store'
import {
  normalizeWritingSkillContextWindow,
  normalizeWritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'

type Context = { params: Promise<{ skillCardId: string }> }

export async function POST(request: Request, context: Context) {
  try {
    const { skillCardId } = await context.params
    const card = readWritingSkillCard(skillCardId)
    if (!card) return jsonError('写作技巧卡不存在', 404)
    const body = await readJsonObject(request)
    const sourceRefs = listWritingSkillCardSources(card.id).map(({ sourceType, sourceId }) => ({ sourceType, sourceId }))
    const job = createWritingSkillJob({
      libraryId: card.libraryId,
      instruction: card.userInstruction,
      modelConfigId: card.modelConfigId,
      randomSeed: createWritingSkillRandomSeed(),
      request: {
        mode: 'regenerate',
        replaceCardId: card.id,
        resample: true,
        sourceRefs,
        scanContextWindow: normalizeWritingSkillContextWindow(body.scanContextWindow),
        scanTotalBudget: normalizeWritingSkillTotalBudget(body.scanTotalBudget),
      },
    })
    scheduleWritingSkillDistillationJob(job.id)
    return NextResponse.json({ ok: true, jobId: job.id, job }, { status: 202 })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to regenerate writing skill card', 400)
  }
}
