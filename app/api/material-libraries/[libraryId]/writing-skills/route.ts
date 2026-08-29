import { NextResponse } from 'next/server'
import { jsonError, noStoreJson, readJsonObject } from '@/lib/server/api-route'
import { scheduleWritingSkillDistillationJob } from '@/lib/server/writing-skill-background'
import {
  createWritingSkillRandomSeed,
} from '@/lib/server/writing-skill-distillation-agent'
import { loadMaterialLibrary } from '@/lib/server/writing-skill-material'
import {
  ConfiguredWritingSkillModelGateway,
  getDefaultWritingSkillModelConfigId,
} from '@/lib/server/writing-skill-model-gateway'
import { refreshWritingSkillCardStaleness } from '@/lib/server/writing-skill-runtime'
import {
  createWritingSkillJob,
  listWritingSkillCards,
  markWritingSkillCardsStaleForLibraryVersion,
} from '@/lib/server/writing-skill-store'
import {
  normalizeWritingSkillContextWindow,
  normalizeWritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'

export const maxDuration = 3600

type Context = { params: Promise<{ libraryId: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const { libraryId } = await context.params
    loadMaterialLibrary(libraryId)
    refreshWritingSkillCardStaleness()
    return noStoreJson({ ok: true, cards: listWritingSkillCards({ libraryId }) })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to list writing skills', 404)
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { libraryId } = await context.params
    const body = await readJsonObject(request)
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (!instruction) return jsonError('请输入想要提炼的写作方向', 400)
    if (instruction.length > 120) return jsonError('写作方向不能超过 120 个字符', 400)
    const modelConfigId = typeof body.modelConfigId === 'string' && body.modelConfigId.trim()
      ? body.modelConfigId.trim()
      : getDefaultWritingSkillModelConfigId()
    const library = loadMaterialLibrary(libraryId)
    await new ConfiguredWritingSkillModelGateway().getCapabilities(modelConfigId)
    markWritingSkillCardsStaleForLibraryVersion(library.id, library.version)
    const job = createWritingSkillJob({
      libraryId,
      instruction,
      modelConfigId,
      randomSeed: createWritingSkillRandomSeed(),
      request: {
        mode: 'create',
        sourceRefs: [{ sourceType: 'LIBRARY', sourceId: libraryId }],
        scanContextWindow: normalizeWritingSkillContextWindow(body.scanContextWindow),
        scanTotalBudget: normalizeWritingSkillTotalBudget(body.scanTotalBudget),
      },
    })
    scheduleWritingSkillDistillationJob(job.id)
    return NextResponse.json({ ok: true, jobId: job.id, job }, { status: 202 })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create writing skill job', 400)
  }
}
