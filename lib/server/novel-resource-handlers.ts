import { NextResponse } from 'next/server'
import {
  ApiRequestError,
  assertJsonMediaType,
  assertWorkspaceSnapshotSemantics,
  noStoreJson,
  readBoundedJsonObject,
} from '@/lib/server/api-route'
import {
  deleteWorkspaceNovel,
  listReadyWorkspaceNovelRegistry,
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
import { resolveWorkspaceNovelId, scopeWorkspaceStateToNovel } from '@/lib/server/workspace-novel-scope'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'
import { runWorkspaceMutation, WorkspaceMutationError } from '@/lib/server/workspace-mutation'
import {
  schedulePendingWorkspaceNovelCleanupScan,
  scheduleWorkspaceKnowledgeSync,
  scheduleWorkspaceKnowledgeSyncRecovery,
  scheduleWorkspaceNovelCleanup,
} from '@/lib/server/workspace-background'

const MAX_WORKSPACE_POST_BODY_BYTES = 16 * 1024 * 1024
const MAX_WORKSPACE_PATCH_BODY_BYTES = 4 * 1024 * 1024

function getNovelWorkspaceDb(novelId: string) {
  return createNovelDatabaseAccess(novelId)
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

async function loadNovelLibrarySummaries() {
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

  return {
    ok: true,
    novels: summaries,
  }
}

export async function getNovelCollection() {
  schedulePendingWorkspaceNovelCleanupScan()
  return noStoreJson(await loadNovelLibrarySummaries())
}

export async function getNovelResource(request: Request, novelId: string) {
  const searchParams = new URL(request.url).searchParams
  const deletionStatus = searchParams.get('deletionStatus')
  if (deletionStatus !== null) {
    if (deletionStatus !== '1') {
      return noStoreJson({ ok: false, error: 'deletionStatus must be 1' }, { status: 400 })
    }

    try {
      return noStoreJson({
        ok: true,
        novelId,
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
    const snapshot = await loadWorkspaceSnapshotFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(novelId))
    scheduleWorkspaceKnowledgeSyncRecovery(novelId)
    return revisionResponse(snapshot.payload, snapshot.revision, novelId)
  } catch (error) {
    console.error('Failed to load novel resource:', error)
    return noStoreJson({ ok: false, error: 'Failed to load novel resource' }, { status: 500 })
  }
}

function stripBrowserSessionState(payload: ReturnType<typeof normalizeWorkspaceState>, novelId: string) {
  return scopeWorkspaceStateToNovel(normalizeWorkspaceState({
    ...payload,
    currentNovelId: novelId,
    currentChapterId: '',
    currentTab: 'editor',
    helperTab: 'ai',
    focusMode: false,
    selectionText: '',
    selectedParagraphIndex: 0,
    presetCompatSessionState: {},
    aiSettings: createEmptyWorkspaceState().aiSettings,
  }), novelId)
}

export async function saveNovelResource(request: Request, novelId: string) {
  try {
    assertJsonMediaType(request)
    const payload = await readBoundedJsonObject(request, MAX_WORKSPACE_POST_BODY_BYTES, 'Workspace JSON body exceeds 16 MiB')
    assertWorkspaceSnapshotSemantics(payload)

    const normalizedPayload = normalizeWorkspaceState(payload)
    const targetNovelId = resolveWorkspaceNovelId(normalizedPayload)
    if (targetNovelId !== novelId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'Novel resource path must match the persisted novel',
      )
    }
    const resourcePayload = stripBrowserSessionState(normalizedPayload, novelId)

    const revisionContract = readRevisionContract(request)
    if (revisionContract.revisionNovelId !== null && revisionContract.revisionNovelId !== novelId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'X-Retale-Revision-Novel-Id must match the resolved workspace novel',
      )
    }
    const allowReset = isExplicitWorkspaceResetRequest(request)
    const result = await runWorkspaceMutation({
      kind: 'full-snapshot',
      novelId,
      payload: resourcePayload,
      backupReason: allowReset ? 'explicit-reset' : 'workspace-save',
      allowEmptyReset: allowReset,
      ...revisionContract,
    })
    if (result.shouldScheduleKnowledgeSync) {
      scheduleWorkspaceKnowledgeSync(novelId)
    }
    return mutationSuccessResponse(result)
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({
        ok: false,
        error: error.status === 400 ? '小说 JSON 无效，请刷新页面后重试。' : error.message,
      }, { status: error.status })
    }
    if (error instanceof WorkspaceMutationError) {
      return mutationErrorResponse(error)
    }
    console.error('Failed to save novel resource:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to save novel resource' },
      { status: 500 }
    )
  }
}

export async function patchChapterResource(request: Request, chapterId: string) {
  try {
    assertJsonMediaType(request)
    const payload = await readBoundedJsonObject(request, MAX_WORKSPACE_PATCH_BODY_BYTES, 'Workspace patch JSON body exceeds 4 MiB')

    const revisionContract = readRequiredRevisionContract(request)
    const patch = readChapterPatchBody(payload)
    if (patch.chapterId !== chapterId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'Chapter resource path must match chapterId',
      )
    }
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
    console.error('Failed to patch chapter resource:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to patch chapter resource' },
      { status: 500 },
    )
  }
}

export async function deleteNovelResource(request: Request, novelId: string) {
  try {
    const searchParams = new URL(request.url).searchParams
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

    console.error('Failed to permanently delete novel:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to permanently delete novel' },
      { status: 500 },
    )
  }
}
