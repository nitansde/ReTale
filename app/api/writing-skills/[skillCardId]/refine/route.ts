import { NextResponse } from 'next/server'
import { jsonError, readJsonObject } from '@/lib/server/api-route'
import { scheduleWritingSkillDistillationJob } from '@/lib/server/writing-skill-background'
import { createWritingSkillRandomSeed } from '@/lib/server/writing-skill-distillation-agent'
import {
  createWritingSkillJob,
  listWritingSkillCardSources,
  readWritingSkillCard,
} from '@/lib/server/writing-skill-store'

type Context = { params: Promise<{ skillCardId: string }> }

export async function POST(request: Request, context: Context) {
  try {
    const { skillCardId } = await context.params
    const card = readWritingSkillCard(skillCardId)
    if (!card) return jsonError('写作技巧卡不存在', 404)
    const body = await readJsonObject(request)
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (!instruction) return jsonError('请输入希望如何调整这张技巧卡', 400)
    if (instruction.length > 300) return jsonError('调整说明不能超过 300 个字符', 400)
    const job = createWritingSkillJob({
      libraryId: card.libraryId,
      instruction: card.userInstruction,
      modelConfigId: card.modelConfigId,
      randomSeed: createWritingSkillRandomSeed(),
      request: {
        mode: 'refine',
        replaceCardId: card.id,
        refineInstruction: instruction,
        sourceRefs: listWritingSkillCardSources(card.id).map(({ sourceType, sourceId }) => ({ sourceType, sourceId })),
      },
    })
    scheduleWritingSkillDistillationJob(job.id)
    return NextResponse.json({ ok: true, jobId: job.id, job }, { status: 202 })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to refine writing skill card', 400)
  }
}
