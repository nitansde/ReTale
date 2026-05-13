import { NextResponse } from 'next/server'
import { findWorkspaceState, upsertWorkspaceState } from '@/lib/server/persistence'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

export async function GET() {
  const workspaceState = findWorkspaceState('singleton')
  const payload = normalizeWorkspaceState(workspaceState ? JSON.parse(workspaceState.payload) : undefined)
  return NextResponse.json(payload)
}

export async function POST(request: Request) {
  const payload = await request.json()
  const saved = upsertWorkspaceState('singleton', JSON.stringify(payload))

  void syncWorkspacePayloadToKnowledgeStore(payload).catch((error) => {
    console.error('Workspace sync failed during save:', error)
  })

  return NextResponse.json({ ok: true, updatedAt: saved?.updatedAt ?? null })
}
