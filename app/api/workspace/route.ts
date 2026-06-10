import { after, NextResponse } from 'next/server'
import {
  claimPendingWorkspaceKnowledgeSync,
  completeWorkspaceKnowledgeSync,
  failWorkspaceKnowledgeSync,
  listReadyWorkspaceNovelRegistry,
  markWorkspaceKnowledgeSyncRequested,
  readActiveWorkspaceNovelId,
  upsertWorkspaceState,
} from '@/lib/server/persistence'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import type { WorkspaceKnowledgeSyncPayload } from '@/lib/server/knowledge-rebuild'
import {
  isExplicitWorkspaceResetRequest,
  loadWorkspacePayloadFromRuntimeOrRecovery,
  loadWorkspaceKnowledgeSyncPayload,
  persistWorkspaceRuntimeState,
  shouldBlockEmptyWorkspaceOverwrite,
} from '@/lib/server/workspace-resilience'
import { resolveWorkspaceNovelId } from '@/lib/server/workspace-novel-scope'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'

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

function getNovelWorkspaceDb(novelId: string) {
  return createNovelDatabaseAccess(novelId)
}

async function loadWorkspacePayloadFromNovelRegistryFallback() {
  const registryRows = listReadyWorkspaceNovelRegistry()
  if (!registryRows.length) {
    return null
  }

  const settledPayloads = await Promise.allSettled(
    registryRows.map((row) => loadWorkspacePayloadFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(row.novelId)))
  )

  const localNovels = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localNovels'][number]>()
  const localVolumes = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localVolumes'][number]>()
  const localChapters = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localChapters'][number]>()

  for (const [index, result] of settledPayloads.entries()) {
    if (result.status === 'rejected') {
      console.warn('Skipping registry workspace restore for novel', registryRows[index]?.novelId, result.reason)
      continue
    }

    for (const novel of result.value.localNovels) {
      if (!localNovels.has(novel.id)) {
        localNovels.set(novel.id, novel)
      }
    }

    for (const volume of result.value.localVolumes) {
      if (!localVolumes.has(volume.id)) {
        localVolumes.set(volume.id, volume)
      }
    }

    for (const chapter of result.value.localChapters) {
      if (!localChapters.has(chapter.id)) {
        localChapters.set(chapter.id, chapter)
      }
    }
  }

  if (!localNovels.size && !localChapters.size) {
    return null
  }

  return normalizeWorkspaceState({
    ...createEmptyWorkspaceState(),
    localNovels: [...localNovels.values()],
    localVolumes: [...localVolumes.values()],
    localChapters: [...localChapters.values()],
  })
}

async function runPendingWorkspaceKnowledgeSync(novelId: string) {
  const workspaceDb = getNovelWorkspaceDb(novelId)

  while (true) {
    const claimed = claimPendingWorkspaceKnowledgeSync('singleton', { db: workspaceDb })
    if (!claimed) return

    try {
      const payload = loadWorkspaceKnowledgeSyncPayload(claimed.workspaceStateId, workspaceDb)
      const scopedPayload = payload
        ? { ...payload, syncScope: 'target-novel' as const }
        : {
        localNovels: [],
        localChapters: [],
        currentNovelId: '',
        syncScope: 'target-novel' as const,
      } satisfies WorkspaceKnowledgeSyncPayload
        await syncWorkspacePayloadToKnowledgeStore(scopedPayload, { db: workspaceDb })
      completeWorkspaceKnowledgeSync(claimed.workspaceStateId, claimed.revision, claimed.sourceUpdatedAt, { db: workspaceDb })
    } catch (error) {
      failWorkspaceKnowledgeSync(
        claimed.workspaceStateId,
        error instanceof Error ? error.message : 'Unknown workspace knowledge sync failure',
        { db: workspaceDb },
      )
      console.error('Workspace knowledge sync failed after save:', error)
      return
    }
  }
}

export async function GET(request: Request = new Request('http://localhost/api/workspace')) {
  try {
    const requestedNovelId = new URL(request.url).searchParams.get('novelId')?.trim() || null
    if (requestedNovelId) {
      const payload = await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(requestedNovelId))
      return NextResponse.json(payload)
    }

    const activeNovelId = readActiveWorkspaceNovelId()
    if (activeNovelId) {
      const payload = await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(activeNovelId))
      return NextResponse.json(payload)
    }

    const registryPayload = await loadWorkspacePayloadFromNovelRegistryFallback()
    if (registryPayload) {
      return NextResponse.json(registryPayload)
    }

    const payload = await loadWorkspacePayloadFromRuntimeOrRecovery()
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
    const targetNovelId = resolveWorkspaceNovelId(normalizedPayload) ?? readActiveWorkspaceNovelId()
    if (!targetNovelId) {
      throw new Error('Unable to determine which novel workspace should be persisted')
    }

    const savedRuntime = await persistWorkspaceRuntimeState(normalizedPayload)
    const saved = upsertWorkspaceState(
      'singleton',
      JSON.stringify(normalizedPayload),
      { backupReason: allowReset ? 'explicit-reset' : 'workspace-save' }
    )

    markWorkspaceKnowledgeSyncRequested('singleton', savedRuntime.updatedAt, { novelId: targetNovelId })
    scheduleAfterResponse(() => runPendingWorkspaceKnowledgeSync(targetNovelId))

    return NextResponse.json({ ok: true, updatedAt: savedRuntime.updatedAt ?? saved?.updatedAt ?? null })
  } catch (error) {
    console.error('Failed to save workspace payload:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to save workspace payload' },
      { status: 500 }
    )
  }
}
