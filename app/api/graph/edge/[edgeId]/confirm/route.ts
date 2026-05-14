import { NextResponse } from 'next/server'
import { confirmEntityLink } from '@/lib/server/graph-store'

type RouteContext = {
  params: Promise<{ edgeId: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { edgeId } = await context.params
    const normalizedEdgeId = edgeId.trim()
    if (!normalizedEdgeId) {
      return NextResponse.json({ ok: false, error: 'edgeId is required' }, { status: 400 })
    }

    const edge = await confirmEntityLink(normalizedEdgeId)
    if (!edge) {
      return NextResponse.json({ ok: false, error: 'Edge not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, edge })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm graph edge'
    const status = message.includes('Expected exactly one matching KnowledgeRelation') ? 409 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
