import { after, NextResponse } from 'next/server'
import { upsertWorkspaceState } from '@/lib/server/persistence'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import {
  isExplicitWorkspaceResetRequest,
  loadWorkspacePayloadWithRecovery,
  shouldBlockEmptyWorkspaceOverwrite,
} from '@/lib/server/workspace-resilience'

export const maxDuration = 3600

let queuedWorkspaceSyncPayload: unknown
let hasQueuedWorkspaceSyncPayload = false
let workspaceSyncScheduled = false
let workspaceSyncRunning = false

function scheduleAfterResponse(callback: () => Promise<void>) {
  if (process.env.NODE_ENV === 'test') {
    setTimeout(() => {
      void callback()
    }, 0)
    return
  }

  try {
    after(callback)
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside a request scope')) {
      setTimeout(() => {
        void callback()
      }, 0)
      return
    }

    console.warn('Falling back to timer-based workspace sync scheduling', error)
    setTimeout(() => {
      void callback()
    }, 0)
  }
}

async function runQueuedWorkspaceKnowledgeSync() {
  if (workspaceSyncRunning) return

  workspaceSyncScheduled = false
  workspaceSyncRunning = true

  try {
    while (hasQueuedWorkspaceSyncPayload) {
      const payload = queuedWorkspaceSyncPayload
      queuedWorkspaceSyncPayload = undefined
      hasQueuedWorkspaceSyncPayload = false

      try {
        await syncWorkspacePayloadToKnowledgeStore(payload)
      } catch (error) {
        console.error('Workspace knowledge sync failed after save:', error)
      }
    }
  } finally {
    workspaceSyncRunning = false
  }
}

function queueWorkspaceKnowledgeSync(payload: unknown) {
  queuedWorkspaceSyncPayload = payload
  hasQueuedWorkspaceSyncPayload = true

  if (workspaceSyncScheduled || workspaceSyncRunning) return

  workspaceSyncScheduled = true
  scheduleAfterResponse(runQueuedWorkspaceKnowledgeSync)
}

export async function GET() {
  try {
    const payload = loadWorkspacePayloadWithRecovery()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Failed to restore workspace payload:', error)
    return NextResponse.json({ ok: false, error: 'Failed to restore saved workspace payload' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const allowReset = isExplicitWorkspaceResetRequest(request)
    if (shouldBlockEmptyWorkspaceOverwrite(payload, allowReset)) {
      return NextResponse.json(
        { ok: false, error: 'Refusing to overwrite a recoverable workspace with an empty payload' },
        { status: 409 }
      )
    }

    const saved = upsertWorkspaceState(
      'singleton',
      JSON.stringify(payload),
      { backupReason: allowReset ? 'explicit-reset' : 'workspace-save' }
    )

    queueWorkspaceKnowledgeSync(payload)

    return NextResponse.json({ ok: true, updatedAt: saved?.updatedAt ?? null })
  } catch (error) {
    console.error('Failed to save workspace payload:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to save workspace payload' },
      { status: 500 }
    )
  }
}
