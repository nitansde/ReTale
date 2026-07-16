import { NextResponse } from 'next/server'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { confirmEntityLink, loadEntityLinkById } from '@/lib/server/graph-store'

type RouteContext = {
  params: Promise<{ edgeId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { edgeId } = await context.params
    const normalizedEdgeId = edgeId.trim()
    if (!normalizedEdgeId) {
      return NextResponse.json({ ok: false, error: 'edgeId is required' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }
    const novelId = String(body.novelId ?? '').trim()
    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    const edge = await runWithNovelDatabaseAccess(novelId, async () => {
      const existing = loadEntityLinkById(normalizedEdgeId)
      if (!existing || existing.novelId !== novelId) return null
      return confirmEntityLink(normalizedEdgeId)
    })
    if (!edge) {
      return NextResponse.json({ ok: false, error: 'Edge not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, edge })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm graph edge'
    const status = message.includes('Expected exactly one matching KnowledgeRelation') ? 409 : message.includes('Invalid novel ID') ? 400 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
