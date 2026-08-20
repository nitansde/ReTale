import { NextResponse } from 'next/server'
import {
  ApiRequestError,
  assertJsonMediaType,
  assertSameOriginRequest,
  assertWorkspaceSnapshotSemantics,
  noStoreJson,
  readBoundedJsonObject,
} from '@/lib/server/api-route'
import {
  deleteWorkspaceNovel,
  listReadyWorkspaceNovelRegistry,
  readActiveWorkspaceNovelId,
  readWorkspaceNovelDeletionState,
  WorkspaceNovelDeletionError,
} from '@/lib/server/persistence'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import {
  hasWorkspaceRuntimeState,
  isExplicitWorkspaceResetRequest,
  loadWorkspacePayloadFromRuntimeOrRecovery,
  loadWorkspaceSnapshotFromRuntimeOrRecovery,
  readWorkspaceLibrarySummary,
} from '@/lib/server/workspace-resilience'
import { resolveWorkspaceNovelId } from '@/lib/server/workspace-novel-scope'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'
import { runWorkspaceMutation, WorkspaceMutationError } from '@/lib/server/workspace-mutation'
import {
  schedulePendingWorkspaceNovelCleanupScan,
  scheduleWorkspaceKnowledgeSync,
  scheduleWorkspaceKnowledgeSyncRecovery,
  scheduleWorkspaceNovelCleanup,
} from '@/lib/server/workspace-background'

export const maxDuration = 3600
const MAX_WORKSPACE_POST_BODY_BYTES = 16 * 1024 * 1024
const MAX_WORKSPACE_PATCH_BODY_BYTES = 4 * 1024 * 1024

function getNovelWorkspaceDb(novelId: string) {
  return createNovelDatabaseAccess(novelId)
}

async function loadWorkspacePayloadFromNovelRegistryFallback(activeNovelId?: string | null) {
  const registryRows = listReadyWorkspaceNovelRegistry()
  if (!registryRows.length) {
    return null
  }

  const settledPayloads = await Promise.allSettled(
    registryRows.map((row) => loadWorkspaceSnapshotFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(row.novelId)))
  )

  const localNovels = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localNovels'][number]>()
  const localVolumes = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localVolumes'][number]>()
  const localChapters = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localChapters'][number]>()
  const localOutlines = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localOutlines'][number]>()
  const localCharacters = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localCharacters'][number]>()
  const localCharacterRelations = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localCharacterRelations'][number]>()
  const localWorldEntries = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localWorldEntries'][number]>()
  const localTimelineEvents = new Map<string, ReturnType<typeof createEmptyWorkspaceState>['localTimelineEvents'][number]>()
  let fallbackSnapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshotFromRuntimeOrRecovery>> | null = null
  let activeSnapshot: Awaited<ReturnType<typeof loadWorkspaceSnapshotFromRuntimeOrRecovery>> | null = null
  let fallbackNovelId: string | null = null

  for (const [index, result] of settledPayloads.entries()) {
    if (result.status === 'rejected') {
      console.warn('Skipping registry workspace restore for novel', registryRows[index]?.novelId, result.reason)
      continue
    }

    const registryNovelId = registryRows[index]?.novelId
    if (registryNovelId) scheduleWorkspaceKnowledgeSyncRecovery(registryNovelId)

    if (registryNovelId === activeNovelId) {
      activeSnapshot = result.value
    }

    if (!fallbackSnapshot) {
      fallbackSnapshot = result.value
      fallbackNovelId = registryNovelId ?? null
    }

    for (const novel of result.value.payload.localNovels) {
      if (!localNovels.has(novel.id)) {
        localNovels.set(novel.id, novel)
      }
    }

    for (const volume of result.value.payload.localVolumes) {
      if (!localVolumes.has(volume.id)) {
        localVolumes.set(volume.id, volume)
      }
    }

    for (const chapter of result.value.payload.localChapters) {
      if (!localChapters.has(chapter.id)) {
        localChapters.set(chapter.id, chapter)
      }
    }

    for (const outline of result.value.payload.localOutlines) {
      if (!localOutlines.has(outline.id)) {
        localOutlines.set(outline.id, outline)
      }
    }

    for (const character of result.value.payload.localCharacters) {
      if (!localCharacters.has(character.id)) {
        localCharacters.set(character.id, character)
      }
    }

    for (const relation of result.value.payload.localCharacterRelations) {
      if (!localCharacterRelations.has(relation.id)) {
        localCharacterRelations.set(relation.id, relation)
      }
    }

    for (const worldEntry of result.value.payload.localWorldEntries) {
      if (!localWorldEntries.has(worldEntry.id)) {
        localWorldEntries.set(worldEntry.id, worldEntry)
      }
    }

    for (const timelineEvent of result.value.payload.localTimelineEvents) {
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

  const revisionSnapshot = activeSnapshot ?? fallbackSnapshot
  const revisionNovelId = activeSnapshot ? activeNovelId : fallbackNovelId
  const basePayload = revisionSnapshot?.payload ?? createEmptyWorkspaceState()

  return {
    payload: normalizeWorkspaceState({
      ...basePayload,
      currentNovelId: activeSnapshot?.payload.currentNovelId || activeNovelId || '',
      currentChapterId: activeSnapshot?.payload.currentChapterId || '',
      localNovels: orderedLocalNovels,
      localVolumes: [...localVolumes.values()],
      localChapters: [...localChapters.values()],
      localOutlines: [...localOutlines.values()],
      localCharacters: [...localCharacters.values()],
      localCharacterRelations: [...localCharacterRelations.values()],
      localWorldEntries: [...localWorldEntries.values()],
      localTimelineEvents: [...localTimelineEvents.values()],
    }),
    revision: revisionSnapshot?.revision ?? 0,
    revisionNovelId,
  }
}

function revisionResponse(payload: ReturnType<typeof normalizeWorkspaceState>, revision: number, revisionNovelId: string) {
  return noStoreJson(
    { ...payload, workspaceRevision: revision, revisionNovelId },
    { headers: {
      'X-Retale-Workspace-Revision': String(revision),
      'X-Retale-Revision-Novel-Id': revisionNovelId,
    } },
  )
}

function readRevisionContract(request: Request, required = false) {
  const idempotencyKey = request.headers.get('Idempotency-Key')
  const baseRevisionValue = request.headers.get('X-Retale-Base-Revision')
  const revisionNovelIdValue = request.headers.get('X-Retale-Revision-Novel-Id')
  const presentCount = [idempotencyKey, baseRevisionValue, revisionNovelIdValue]
    .filter((value) => value !== null).length
  if (presentCount > 0 && presentCount < 3) {
    throw new WorkspaceMutationError(
      'invalid_mutation_contract',
      'Idempotency-Key, X-Retale-Base-Revision, and X-Retale-Revision-Novel-Id must be provided together',
    )
  }
  if (idempotencyKey === null || baseRevisionValue === null || revisionNovelIdValue === null) {
    if (required) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'Idempotency-Key, X-Retale-Base-Revision, and X-Retale-Revision-Novel-Id are required',
      )
    }
    return { idempotencyKey: null, baseRevision: null, revisionNovelId: null }
  }
  if (!idempotencyKey.trim()) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'Idempotency-Key must be non-empty')
  }
  const revisionNovelId = revisionNovelIdValue.trim()
  if (!revisionNovelId) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'X-Retale-Revision-Novel-Id must be non-empty')
  }
  if (!/^\d+$/.test(baseRevisionValue)) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'X-Retale-Base-Revision must be a non-negative integer')
  }
  const baseRevision = Number(baseRevisionValue)
  if (!Number.isSafeInteger(baseRevision)) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'X-Retale-Base-Revision must be a safe non-negative integer')
  }
  return { idempotencyKey, baseRevision, revisionNovelId }
}

function readRequiredRevisionContract(request: Request) {
  const contract = readRevisionContract(request, true)
  if (contract.idempotencyKey === null || contract.baseRevision === null || contract.revisionNovelId === null) {
    throw new WorkspaceMutationError(
      'invalid_mutation_contract',
      'Idempotency-Key, X-Retale-Base-Revision, and X-Retale-Revision-Novel-Id are required',
    )
  }
  return contract
}

function readChapterPatchBody(payload: Record<string, unknown>) {
  if (typeof payload.novelId !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'novelId must be a string')
  }
  if (typeof payload.chapterId !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'chapterId must be a string')
  }
  if (typeof payload.content !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'content must be a string')
  }
  if (typeof payload.wordCount !== 'number') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'wordCount must be a number')
  }
  if (!Number.isSafeInteger(payload.wordCount) || payload.wordCount < 0) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'wordCount must be a safe non-negative integer')
  }
  if (typeof payload.updatedAtLabel !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'updatedAtLabel must be a string')
  }
  if (payload.content.length > 1_000_000) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'content may contain at most 1000000 characters')
  }
  if (payload.updatedAtLabel.length > 128) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'updatedAtLabel may contain at most 128 characters')
  }
  return {
    novelId: payload.novelId,
    chapterId: payload.chapterId,
    content: payload.content,
    wordCount: payload.wordCount,
    updatedAtLabel: payload.updatedAtLabel,
  }
}

function mutationErrorResponse(error: WorkspaceMutationError) {
  if (error.code === 'invalid_mutation_contract') {
    return NextResponse.json({ ok: false, code: 'invalid_revision_contract', error: error.message }, { status: 422 })
  }
  const status = ['stale_revision', 'idempotency_key_reused', 'novel_not_ready', 'empty_overwrite_blocked'].includes(error.code)
    ? 409
    : ['novel_not_found', 'chapter_not_found'].includes(error.code) ? 404 : 500
  return NextResponse.json({
    ok: false,
    code: error.code,
    error: status === 500 ? 'Workspace persistence failed' : error.message,
    ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    ...(error.chapter === undefined ? {} : { chapter: error.chapter }),
  }, { status })
}

function mutationSuccessResponse(result: Awaited<ReturnType<typeof runWorkspaceMutation>>) {
  return NextResponse.json(result, { headers: {
    'X-Retale-Workspace-Revision': String(result.revision),
    'X-Retale-Revision-Novel-Id': result.novelId,
  } })
}

async function loadWorkspaceLibrarySummaries() {
  const activeNovelId = readActiveWorkspaceNovelId()
  const registryRows = listReadyWorkspaceNovelRegistry()
  const settledSummaries = await Promise.allSettled(
    registryRows.map(async (row) => {
      const workspaceDb = getNovelWorkspaceDb(row.novelId)
      if (!hasWorkspaceRuntimeState('singleton', workspaceDb)) {
        await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', workspaceDb)
      }
      scheduleWorkspaceKnowledgeSyncRecovery(row.novelId)
      return readWorkspaceLibrarySummary('singleton', workspaceDb)
    })
  )
  const summaries = settledSummaries.flatMap((result, index) => {
    if (result.status === 'rejected') {
      console.warn('Skipping registry library summary for novel', registryRows[index]?.novelId, result.reason)
      return []
    }
    return result.value ? [result.value] : []
  })

  if (activeNovelId) {
    summaries.sort((left, right) => Number(right.id === activeNovelId) - Number(left.id === activeNovelId))
  }

  return {
    ok: true,
    activeNovelId,
    novels: summaries,
  }
}

export async function GET(request: Request) {
  request ??= new Request('http://localhost/api/workspace')
  const searchParams = new URL(request.url).searchParams
  const librarySummary = searchParams.get('librarySummary')
  if (librarySummary !== null) {
    if (librarySummary !== '1') {
      return noStoreJson({ ok: false, error: 'librarySummary must be 1' }, { status: 400 })
    }

    schedulePendingWorkspaceNovelCleanupScan()
    return noStoreJson(await loadWorkspaceLibrarySummaries())
  }

  const deletionStatus = searchParams.get('deletionStatus')
  if (deletionStatus !== null) {
    if (deletionStatus !== '1') {
      return noStoreJson({ ok: false, error: 'deletionStatus must be 1' }, { status: 400 })
    }

    const novelId = searchParams.get('novelId')
    if (novelId === null) {
      return noStoreJson({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    try {
      return noStoreJson({
        ok: true,
        novelId: novelId.trim(),
        deletionState: readWorkspaceNovelDeletionState(novelId),
      })
    } catch (error) {
      if (error instanceof WorkspaceNovelDeletionError) {
        return noStoreJson({ ok: false, error: error.message }, { status: error.status })
      }
      throw error
    }
  }

  schedulePendingWorkspaceNovelCleanupScan()

  try {
    const requestedNovelId = searchParams.get('novelId')?.trim() || null
    if (requestedNovelId) {
      const snapshot = await loadWorkspaceSnapshotFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(requestedNovelId))
      scheduleWorkspaceKnowledgeSyncRecovery(requestedNovelId)
      return revisionResponse(snapshot.payload, snapshot.revision, requestedNovelId)
    }

    const activeNovelId = readActiveWorkspaceNovelId()
    const registryPayload = await loadWorkspacePayloadFromNovelRegistryFallback(activeNovelId)
    if (registryPayload) {
      if (!registryPayload.revisionNovelId) {
        throw new Error('Unable to determine registry workspace revision owner')
      }
      return revisionResponse(registryPayload.payload, registryPayload.revision, registryPayload.revisionNovelId)
    }

    if (activeNovelId) {
      const snapshot = await loadWorkspaceSnapshotFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(activeNovelId))
      scheduleWorkspaceKnowledgeSyncRecovery(activeNovelId)
      return revisionResponse(snapshot.payload, snapshot.revision, activeNovelId)
    }

    const payload = await loadWorkspacePayloadFromRuntimeOrRecovery()
    return noStoreJson(payload)
  } catch (error) {
    console.error('Failed to restore workspace payload:', error)
    return noStoreJson({ ok: false, error: 'Failed to restore saved workspace payload' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request)
    assertJsonMediaType(request)
    const payload = await readBoundedJsonObject(request, MAX_WORKSPACE_POST_BODY_BYTES, 'Workspace JSON body exceeds 16 MiB')
    assertWorkspaceSnapshotSemantics(payload)

    const normalizedPayload = normalizeWorkspaceState(payload)
    const targetNovelId = resolveWorkspaceNovelId(normalizedPayload) ?? readActiveWorkspaceNovelId()
    if (!targetNovelId) {
      throw new Error('Unable to determine which novel workspace should be persisted')
    }

    const revisionContract = readRevisionContract(request)
    if (revisionContract.revisionNovelId !== null && revisionContract.revisionNovelId !== targetNovelId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'X-Retale-Revision-Novel-Id must match the resolved workspace novel',
      )
    }
    const allowReset = isExplicitWorkspaceResetRequest(request)
    const result = await runWorkspaceMutation({
      kind: 'full-snapshot',
      novelId: targetNovelId,
      payload: normalizedPayload,
      backupReason: allowReset ? 'explicit-reset' : 'workspace-save',
      allowEmptyReset: allowReset,
      ...revisionContract,
    })
    if (result.shouldScheduleKnowledgeSync) {
      scheduleWorkspaceKnowledgeSync(targetNovelId)
    }
    return mutationSuccessResponse(result)
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({
        ok: false,
        error: error.status === 400 ? '工作区 JSON 无效，请刷新页面后重试。' : error.message,
      }, { status: error.status })
    }
    if (error instanceof WorkspaceMutationError) {
      return mutationErrorResponse(error)
    }
    console.error('Failed to save workspace payload:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to save workspace payload' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request)
    assertJsonMediaType(request)
    const payload = await readBoundedJsonObject(request, MAX_WORKSPACE_PATCH_BODY_BYTES, 'Workspace patch JSON body exceeds 4 MiB')

    const revisionContract = readRequiredRevisionContract(request)
    const patch = readChapterPatchBody(payload)
    if (revisionContract.revisionNovelId !== patch.novelId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'X-Retale-Revision-Novel-Id must match novelId',
      )
    }
    const result = await runWorkspaceMutation({
      kind: 'chapter-patch',
      ...patch,
      baseRevision: revisionContract.baseRevision,
      idempotencyKey: revisionContract.idempotencyKey,
    })
    if (result.shouldScheduleKnowledgeSync) {
      scheduleWorkspaceKnowledgeSync(result.novelId)
    }
    return mutationSuccessResponse(result)
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    if (error instanceof WorkspaceMutationError) {
      return mutationErrorResponse(error)
    }
    console.error('Failed to patch workspace payload:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to patch workspace payload' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request)
    const searchParams = new URL(request.url).searchParams
    const novelId = searchParams.get('novelId')
    if (novelId === null) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    const result = await deleteWorkspaceNovel({
      novelId,
      nextNovelId: searchParams.get('nextNovelId'),
    })
    if (result.cleanupPending) {
      scheduleWorkspaceNovelCleanup(result.deletedNovelId)
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.cleanupPending ? 202 : 200 })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    if (error instanceof WorkspaceNovelDeletionError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }

    console.error('Failed to permanently delete novel workspace:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to permanently delete novel workspace' },
      { status: 500 },
    )
  }
}
