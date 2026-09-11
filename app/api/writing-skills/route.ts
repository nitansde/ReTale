import { NextResponse } from 'next/server'
import { apiRequestErrorResponse, jsonError, noStoreJson, readJsonObject } from '@/lib/server/api-route'
import { scheduleWritingSkillDistillationJob } from '@/lib/server/writing-skill-background'
import { createWritingSkillRandomSeed } from '@/lib/server/writing-skill-distillation-agent'
import {
  ConfiguredWritingSkillModelGateway,
  getDefaultWritingSkillModelConfigId,
} from '@/lib/server/writing-skill-model-gateway'
import { refreshWritingSkillCardStaleness } from '@/lib/server/writing-skill-runtime'
import { createWritingSkillJob, listWritingSkillCards } from '@/lib/server/writing-skill-store'
import {
  loadWritingSkillMaterialCollection,
  normalizeWritingSkillSourceRefs,
} from '@/lib/server/writing-skill-sources'
import type { WritingSkillCardStatus } from '@/lib/writing-skill-types'
import {
  normalizeWritingSkillContextWindow,
  normalizeWritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'

export const maxDuration = 3600

export async function GET(request: Request) {
  refreshWritingSkillCardStaleness()
  const params = new URL(request.url).searchParams
  const libraryId = params.get('libraryId')?.trim() || undefined
  const rawStatus = params.get('status')?.trim()
  const status = rawStatus === 'ACTIVE' || rawStatus === 'STALE' || rawStatus === 'ARCHIVED'
    ? rawStatus as WritingSkillCardStatus
    : undefined
  return noStoreJson({
    ok: true,
    cards: listWritingSkillCards({ libraryId, status }),
  })
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request)
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (!instruction) return jsonError('请输入想要提炼的写作方向', 400)
    if (instruction.length > 120) return jsonError('写作方向不能超过 120 个字符', 400)
    const sourceRefs = normalizeWritingSkillSourceRefs(body.sourceRefs)
    if (!sourceRefs.length) return jsonError('请至少选择一本蒸馏素材', 400)
    const modelConfigId = typeof body.modelConfigId === 'string' && body.modelConfigId.trim()
      ? body.modelConfigId.trim()
      : getDefaultWritingSkillModelConfigId()
    const [{ library }] = await Promise.all([
      Promise.resolve(loadWritingSkillMaterialCollection(sourceRefs)),
      new ConfiguredWritingSkillModelGateway().getCapabilities(modelConfigId),
    ])
    const job = createWritingSkillJob({
      libraryId: library.id,
      instruction,
      modelConfigId,
      randomSeed: createWritingSkillRandomSeed(),
      request: {
        mode: 'create',
        sourceRefs,
        scanContextWindow: normalizeWritingSkillContextWindow(body.scanContextWindow),
        scanTotalBudget: normalizeWritingSkillTotalBudget(body.scanTotalBudget),
      },
    })
    scheduleWritingSkillDistillationJob(job.id)
    return NextResponse.json({ ok: true, jobId: job.id, job }, { status: 202 })
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    return jsonError(error instanceof Error ? error.message : 'Failed to create writing skill job', 400)
  }
}
