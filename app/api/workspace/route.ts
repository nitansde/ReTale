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

async function loadWorkspacePayloadFromNovelRegistryFallback(activeNovelId?: string | null) {
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
  const localOutlines = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localOutlines'][number]>()
  const localCharacters = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localCharacters'][number]>()
  const localCharacterRelations = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localCharacterRelations'][number]>()
  const localWorldEntries = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localWorldEntries'][number]>()
  const localTimelineEvents = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localTimelineEvents'][number]>()
  let fallbackPayload: Awaited<ReturnType<typeof loadWorkspacePayloadFromRuntimeOrRecovery>> | null = null
  let activePayload: Awaited<ReturnType<typeof loadWorkspacePayloadFromRuntimeOrRecovery>> | null = null

  for (const [index, result] of settledPayloads.entries()) {
    if (result.status === 'rejected') {
      console.warn('Skipping registry workspace restore for novel', registryRows[index]?.novelId, result.reason)
      continue
    }

    if (registryRows[index]?.novelId === activeNovelId) {
      activePayload = result.value
    }

    fallbackPayload ??= result.value

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

    for (const outline of result.value.localOutlines) {
      if (!localOutlines.has(outline.id)) {
        localOutlines.set(outline.id, outline)
      }
    }

    for (const character of result.value.localCharacters) {
      if (!localCharacters.has(character.id)) {
        localCharacters.set(character.id, character)
      }
    }

    for (const relation of result.value.localCharacterRelations) {
      if (!localCharacterRelations.has(relation.id)) {
        localCharacterRelations.set(relation.id, relation)
      }
    }

    for (const worldEntry of result.value.localWorldEntries) {
      if (!localWorldEntries.has(worldEntry.id)) {
        localWorldEntries.set(worldEntry.id, worldEntry)
      }
    }

    for (const timelineEvent of result.value.localTimelineEvents) {
      if (!localTimelineEvents.has(timelineEvent.id)) {
        localTimelineEvents.set(timelineEvent.id, timelineEvent)
      }
    }
  }

  if (!localNovels.size && !localChapters.size) {
    return null
  }

  const orderedLocalNovels = [...localNovels.values()]
  if (activeNovelId && localNovels.has(activeNovelId)) {
    orderedLocalNovels.sort((left, right) => {
      const activeDiff = Number(right.id === activeNovelId) - Number(left.id === activeNovelId)
      if (activeDiff !== 0) return activeDiff
      return 0
    })
  }

  const basePayload = activePayload ?? fallbackPayload ?? createEmptyWorkspaceState()

  return normalizeWorkspaceState({
    ...basePayload,
    currentNovelId: activePayload?.currentNovelId || activeNovelId || '',
    currentChapterId: activePayload?.currentChapterId || '',
    localNovels: orderedLocalNovels,
    localVolumes: [...localVolumes.values()],
    localChapters: [...localChapters.values()],
    localOutlines: [...localOutlines.values()],
    localCharacters: [...localCharacters.values()],
    localCharacterRelations: [...localCharacterRelations.values()],
    localWorldEntries: [...localWorldEntries.values()],
    localTimelineEvents: [...localTimelineEvents.values()],
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
    const registryPayload = await loadWorkspacePayloadFromNovelRegistryFallback(activeNovelId)
    if (registryPayload) {
      return NextResponse.json(registryPayload)
    }

    if (activeNovelId) {
      const payload = await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(activeNovelId))
      return NextResponse.json(payload)
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
