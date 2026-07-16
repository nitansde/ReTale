import { NextResponse } from 'next/server'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { editEntityLink, loadEntityLinkById } from '@/lib/server/graph-store'

type RouteContext = {
  params: Promise<{ edgeId: string }>
}

function normalizeOptionalText(value: unknown) {
  if (value === undefined) return undefined
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function normalizeOptionalPolarity(value: unknown) {
  if (value === undefined) return undefined
  const normalized = String(value).trim()
  if (!normalized) return null
  if (normalized === 'positive' || normalized === 'negative' || normalized === 'neutral' || normalized === 'mixed') {
    return normalized
  }

  throw new Error('polarity must be positive, negative, neutral, mixed, or null')
}

function normalizeOptionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${field} must be a positive integer`)
  }

  return numeric
}

function normalizeOptionalStrength(value: unknown) {
  if (value === undefined) return undefined
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
    throw new Error('strength must be an integer between 1 and 5')
  }

  return numeric
}

function normalizeOptionalBoolean(value: unknown, field: string) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`)
  }

  return value
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { edgeId } = await context.params
    const normalizedEdgeId = edgeId.trim()
    if (!normalizedEdgeId) {
      return NextResponse.json({ ok: false, error: 'edgeId is required' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const novelId = String(body.novelId ?? '').trim()
    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    if (Object.prototype.hasOwnProperty.call(body, 'validToChapter')) {
      return NextResponse.json({ ok: false, error: 'validToChapter is no longer supported; use validUntilChapter' }, { status: 400 })
    }

    let normalizedLinkType: string | undefined
    if (body.linkType !== undefined) {
      const candidate = String(body.linkType).trim()
      if (!candidate) {
        return NextResponse.json({ ok: false, error: 'linkType must be a non-empty string' }, { status: 400 })
      }
      normalizedLinkType = candidate
    }

    const validFromChapter = normalizeOptionalPositiveInteger(body.validFromChapter, 'validFromChapter')
    const validUntilChapter = normalizeOptionalPositiveInteger(body.validUntilChapter, 'validUntilChapter')
    if (typeof validFromChapter === 'number' && typeof validUntilChapter === 'number' && validUntilChapter <= validFromChapter) {
      return NextResponse.json({ ok: false, error: 'validUntilChapter must be greater than validFromChapter' }, { status: 400 })
    }

    const edge = await runWithNovelDatabaseAccess(novelId, async () => {
      const existing = loadEntityLinkById(normalizedEdgeId)
      if (!existing || existing.novelId !== novelId) return null

      return editEntityLink({
        id: normalizedEdgeId,
        linkType: normalizedLinkType,
        label: normalizeOptionalText(body.label),
        description: normalizeOptionalText(body.description),
        polarity: normalizeOptionalPolarity(body.polarity),
        strength: normalizeOptionalStrength(body.strength),
        validFromChapter: typeof validFromChapter === 'number' ? validFromChapter : undefined,
        validUntilChapter,
        includeByDefault: normalizeOptionalBoolean(body.includeByDefault, 'includeByDefault'),
      })
    })

    if (!edge) {
      return NextResponse.json({ ok: false, error: 'Edge not found' }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      edge,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to edit graph edge'
    const status = message.includes('Expected exactly one matching KnowledgeRelation') ? 409 : message.includes('must') || message.includes('Invalid JSON body') || message.includes('Invalid novel ID') ? 400 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
