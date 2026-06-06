import { after, NextResponse } from 'next/server'
import {
  claimPendingWorkspaceKnowledgeSync,
  completeWorkspaceKnowledgeSync,
  failWorkspaceKnowledgeSync,
  markWorkspaceKnowledgeSyncRequested,
  upsertWorkspaceState,
} from '@/lib/server/persistence'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import type { WorkspaceKnowledgeSyncPayload } from '@/lib/server/knowledge-rebuild'
import {
  isExplicitWorkspaceResetRequest,
  loadWorkspacePayloadFromRuntimeOrRecovery,
  loadWorkspaceKnowledgeSyncPayload,
  persistWorkspaceRuntimeState,
  shouldBlockEmptyWorkspaceOverwrite,
} from '@/lib/server/workspace-resilience'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

export const maxDuration = 3600

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

async function runPendingWorkspaceKnowledgeSync() {
  while (true) {
    const claimed = claimPendingWorkspaceKnowledgeSync('singleton')
    if (!claimed) return

    try {
      const payload = loadWorkspaceKnowledgeSyncPayload(claimed.workspaceStateId) ?? {
        localNovels: [],
        localChapters: [],
        currentNovelId: '',
      } satisfies WorkspaceKnowledgeSyncPayload
      await syncWorkspacePayloadToKnowledgeStore(payload)
      completeWorkspaceKnowledgeSync(claimed.workspaceStateId, claimed.revision, claimed.sourceUpdatedAt)
    } catch (error) {
      failWorkspaceKnowledgeSync(
        claimed.workspaceStateId,
        error instanceof Error ? error.message : 'Unknown workspace knowledge sync failure'
      )
      console.error('Workspace knowledge sync failed after save:', error)
      return
    }
  }
}

export async function GET() {
  try {
    const payload = loadWorkspacePayloadFromRuntimeOrRecovery()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Failed to restore workspace payload:', error)
    return NextResponse.json({ ok: false, error: 'Failed to restore saved workspace payload' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ ok: false, error: '工作区 JSON 无效，请刷新页面后重试。' }, { status: 400 })
    }

    const allowReset = isExplicitWorkspaceResetRequest(request)
    if (shouldBlockEmptyWorkspaceOverwrite(payload, allowReset)) {
      return NextResponse.json(
        { ok: false, error: 'Refusing to overwrite a recoverable workspace with an empty payload' },
        { status: 409 }
      )
    }

    const normalizedPayload = normalizeWorkspaceState(payload)
    const savedRuntime = persistWorkspaceRuntimeState(normalizedPayload)
    const saved = upsertWorkspaceState(
      'singleton',
      JSON.stringify(normalizedPayload),
      { backupReason: allowReset ? 'explicit-reset' : 'workspace-save' }
    )

    markWorkspaceKnowledgeSyncRequested('singleton', savedRuntime.updatedAt)
    scheduleAfterResponse(runPendingWorkspaceKnowledgeSync)

    return NextResponse.json({ ok: true, updatedAt: savedRuntime.updatedAt ?? saved?.updatedAt ?? null })
  } catch (error) {
    console.error('Failed to save workspace payload:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to save workspace payload' },
      { status: 500 }
    )
  }
}
