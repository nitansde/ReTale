import { jsonError, noStoreJson, readJsonObject } from '@/lib/server/api-route'
import {
  refreshWritingSkillCardStaleness,
  resolveWritingSkillCardDetail,
} from '@/lib/server/writing-skill-runtime'
import {
  deleteWritingSkillCard,
  readWritingSkillCardDetail,
  updateWritingSkillCard,
} from '@/lib/server/writing-skill-store'
import type { WritingSkillCardStatus } from '@/lib/writing-skill-types'

type Context = { params: Promise<{ skillCardId: string }> }

function refreshCard(skillCardId: string) {
  const initial = readWritingSkillCardDetail(skillCardId)
  if (!initial) return null
  refreshWritingSkillCardStaleness()
  return resolveWritingSkillCardDetail({ cardId: skillCardId })
}

export async function GET(_request: Request, context: Context) {
  const { skillCardId } = await context.params
  const card = refreshCard(skillCardId)
  return card
    ? noStoreJson({ ok: true, card })
    : jsonError('写作技巧卡不存在', 404)
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { skillCardId } = await context.params
    if (!readWritingSkillCardDetail(skillCardId)) return jsonError('写作技巧卡不存在', 404)
    const body = await readJsonObject(request)
    const status = body.status === 'ACTIVE' || body.status === 'STALE' || body.status === 'ARCHIVED'
      ? body.status as WritingSkillCardStatus
      : undefined
    const examples = Array.isArray(body.examples)
      ? body.examples.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return []
          const record = item as Record<string, unknown>
          return typeof record.id === 'string' && typeof record.enabled === 'boolean'
            ? [{ id: record.id, enabled: record.enabled }]
            : []
        })
      : undefined
    await updateWritingSkillCard(skillCardId, {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.defaultExampleCount === 'number' ? { defaultExampleCount: body.defaultExampleCount } : {}),
      ...(status ? { status } : {}),
      ...(examples ? { examples } : {}),
    })
    return noStoreJson({ ok: true, card: resolveWritingSkillCardDetail({ cardId: skillCardId }) })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update writing skill card', 400)
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { skillCardId } = await context.params
    return deleteWritingSkillCard(skillCardId)
      ? noStoreJson({ ok: true })
      : jsonError('写作技巧卡不存在', 404)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete writing skill card', 400)
  }
}
