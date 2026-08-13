import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createControlDatabaseAccess, createCreatingNovelDatabaseAccess, createDatabaseAccess, type DatabaseAccess } from '@/lib/server/database-access'
import { getNovelDb, getNovelStoragePaths, runWithCreatingNovelResolution, validateNovelId } from '@/lib/server/db-resolver'
import { runWithPerNovelWriteGate } from '@/lib/server/per-novel-write-gate'
import {
  createWorkspaceStateBackupInDb,
  abortWorkspaceNovelCreation,
  beginWorkspaceNovelCreation,
  claimPendingWorkspaceKnowledgeSync,
  completeWorkspaceKnowledgeSync,
  failWorkspaceKnowledgeSync,
  markWorkspaceKnowledgeSyncRequestedInDb,
  publishWorkspaceNovelCreation,
  pruneWorkspaceStateBackupsInDb,
  renewWorkspaceNovelCreation,
  readWorkspaceStateFromDb,
  writeWorkspaceStateInDb,
} from '@/lib/server/persistence'
import {
  loadWorkspaceKnowledgeSyncPayload,
  readWorkspaceRuntimeSnapshotFromDb,
  replaceWorkspaceRuntimeStateInDb,
  workspacePayloadHasLibraryContent,
} from '@/lib/server/workspace-resilience'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import type { WorkspaceKnowledgeSyncPayload } from '@/lib/server/knowledge-rebuild'
import { scopeWorkspaceStateToNovel } from '@/lib/server/workspace-novel-scope'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import type { Chapter, PersistedNovelState } from '@/lib/types'

const MUTATION_CONTRACT_VERSION = 1
const DEFAULT_WORKSPACE_STATE_ID = 'singleton'
const MAX_IDEMPOTENCY_KEY_LENGTH = 256
const MAX_WORKSPACE_STATE_ID_LENGTH = 256
const REPLAY_RETENTION_DAYS = 7
const REPLAY_RETENTION_LIMIT = 512

export type WorkspaceMutationOperation = 'chapter-patch' | 'full-snapshot'
export type WorkspaceMutationErrorCode =
  | 'novel_not_found'
  | 'novel_not_ready'
  | 'chapter_not_found'
  | 'stale_revision'
  | 'idempotency_key_reused'
  | 'empty_overwrite_blocked'
  | 'invalid_mutation_contract'
  | 'persistence_failed'

export type ChapterPatchMutationRequest = {
  kind: 'chapter-patch'
  novelId: string
  workspaceStateId?: string
  chapterId: string
  baseRevision: number
  idempotencyKey: string
  content: string
  wordCount: number
  updatedAtLabel: string
}

export type FullSnapshotMutationRequest = {
  kind: 'full-snapshot'
  novelId: string
  workspaceStateId?: string
  payload: PersistedNovelState
  backupReason: 'workspace-save' | 'explicit-reset' | 'import-txt'
  allowEmptyReset: boolean
  baseRevision: number | null
  idempotencyKey: string | null
}

export type WorkspaceMutationRequest = ChapterPatchMutationRequest | FullSnapshotMutationRequest

type WorkspaceMutationSuccessBase = {
  ok: true
  operation: WorkspaceMutationOperation
  novelId: string
  revision: number
  updatedAt: string
  replayed: boolean
  shouldScheduleKnowledgeSync: boolean
}

export type ChapterPatchMutationResult = WorkspaceMutationSuccessBase & {
  operation: 'chapter-patch'
  chapterId: string
}

export type FullSnapshotMutationResult = WorkspaceMutationSuccessBase & {
  operation: 'full-snapshot'
}

export type WorkspaceMutationResult = ChapterPatchMutationResult | FullSnapshotMutationResult

type WorkspaceMutationErrorContext = {
  novelId?: string
  workspaceStateId?: string
  chapterId?: string
  currentRevision?: number
  chapter?: Chapter | null
  cause?: unknown
}

export class WorkspaceMutationError extends Error {
  readonly novelId?: string
  readonly workspaceStateId?: string
  readonly chapterId?: string
  readonly currentRevision?: number
  readonly chapter?: Chapter | null

  constructor(
    readonly code: WorkspaceMutationErrorCode,
    message: string,
    context: WorkspaceMutationErrorContext = {},
  ) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause })
    this.name = 'WorkspaceMutationError'
    this.novelId = context.novelId
    this.workspaceStateId = context.workspaceStateId
    this.chapterId = context.chapterId
    this.currentRevision = context.currentRevision
    this.chapter = context.chapter
  }
}

export type WorkspaceMutationFaultStage = 'after_runtime' | 'after_artifact' | 'after_sync' | 'before_replay'
type WorkspaceMutationFaultInjector = (stage: WorkspaceMutationFaultStage) => void

let workspaceMutationFaultInjector: WorkspaceMutationFaultInjector | null = null

export function setWorkspaceMutationFaultInjectorForTests(injector: WorkspaceMutationFaultInjector | null) {
  if (process.env.VITEST !== 'true' && injector !== null) {
    throw new Error('Workspace mutation fault injection is only available in tests')
  }
  workspaceMutationFaultInjector = injector
}

let workspaceNovelCreationFaultInjector: (() => void) | null = null

export function setWorkspaceNovelCreationFaultInjectorForTests(injector: (() => void) | null) {
  if (process.env.VITEST !== 'true' && injector !== null) {
    throw new Error('Workspace novel creation fault injection is only available in tests')
  }
  workspaceNovelCreationFaultInjector = injector
}

type ValidatedChapterPatch = Omit<ChapterPatchMutationRequest, 'workspaceStateId'> & {
  workspaceStateId: string
}

type ValidatedFullSnapshot = Omit<FullSnapshotMutationRequest, 'workspaceStateId' | 'payload'> & {
  workspaceStateId: string
  payload: PersistedNovelState
}

type ValidatedWorkspaceMutation = ValidatedChapterPatch | ValidatedFullSnapshot

type ReplayRow = {
  operation: WorkspaceMutationOperation
  requestHash: string
  responseStatus: number
  responseJson: string
}

type RegistryRow = {
  migrationStatus: string
}

function invalidContract(message: string, context: WorkspaceMutationErrorContext = {}): never {
  throw new WorkspaceMutationError('invalid_mutation_contract', message, context)
}

function validateBoundedNonEmptyString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    invalidContract(`${field} must be a non-empty string no longer than ${maxLength} characters`)
  }
  return value
}

function validateRevision(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    invalidContract(`${field} must be an integer greater than or equal to zero`)
  }
  return Number(value)
}

function validateRequest(request: WorkspaceMutationRequest): ValidatedWorkspaceMutation {
  if (!request || typeof request !== 'object') {
    invalidContract('Workspace mutation request must be an object')
  }

  let novelId: string
  try {
    novelId = validateNovelId(request.novelId)
  } catch (error) {
    invalidContract(error instanceof Error ? error.message : 'Invalid novel ID', { cause: error })
  }
  const workspaceStateId = validateBoundedNonEmptyString(
    request.workspaceStateId ?? DEFAULT_WORKSPACE_STATE_ID,
    'workspaceStateId',
    MAX_WORKSPACE_STATE_ID_LENGTH,
  )

  if (request.kind === 'chapter-patch') {
    return {
      kind: request.kind,
      novelId,
      workspaceStateId,
      chapterId: validateBoundedNonEmptyString(request.chapterId, 'chapterId', 512),
      baseRevision: validateRevision(request.baseRevision, 'baseRevision'),
      idempotencyKey: validateBoundedNonEmptyString(request.idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH),
      content: typeof request.content === 'string' ? request.content : invalidContract('content must be a string'),
      wordCount: validateRevision(request.wordCount, 'wordCount'),
      updatedAtLabel: typeof request.updatedAtLabel === 'string'
        ? request.updatedAtLabel
        : invalidContract('updatedAtLabel must be a string'),
    }
  }

  if (request.kind !== 'full-snapshot') {
    invalidContract('Unsupported workspace mutation operation')
  }
  if (!['workspace-save', 'explicit-reset', 'import-txt'].includes(request.backupReason)) {
    invalidContract('backupReason must be workspace-save, explicit-reset, or import-txt')
  }
  if (typeof request.allowEmptyReset !== 'boolean') {
    invalidContract('allowEmptyReset must be a boolean')
  }
  const hasRevision = request.baseRevision !== null
  const hasKey = request.idempotencyKey !== null
  if (hasRevision !== hasKey) {
    invalidContract('baseRevision and idempotencyKey must either both be present or both be null')
  }
  const baseRevision = request.baseRevision === null ? null : validateRevision(request.baseRevision, 'baseRevision')
  const idempotencyKey = request.idempotencyKey === null
    ? null
    : validateBoundedNonEmptyString(request.idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH)
  const normalized = normalizeWorkspaceState(request.payload)
  const payload = scopeWorkspaceStateToNovel(normalized, novelId)

  return {
    kind: request.kind,
    novelId,
    workspaceStateId,
    payload,
    backupReason: request.backupReason,
    allowEmptyReset: request.allowEmptyReset,
    baseRevision,
    idempotencyKey,
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalizeJson(entryValue)]),
    )
  }
  return value
}

export function hashWorkspaceMutationRequest(request: WorkspaceMutationRequest) {
  return hashValidatedRequest(validateRequest(request))
}

function hashValidatedRequest(request: ValidatedWorkspaceMutation) {
  const operationPayload = request.kind === 'chapter-patch'
    ? {
        chapterId: request.chapterId,
        content: request.content,
        wordCount: request.wordCount,
        updatedAtLabel: request.updatedAtLabel,
      }
    : {
        payload: request.payload,
        backupReason: request.backupReason,
        allowEmptyReset: request.allowEmptyReset,
      }
  const hashInput = canonicalizeJson({
    contractVersion: MUTATION_CONTRACT_VERSION,
    operation: request.kind,
    workspaceStateId: request.workspaceStateId,
    novelId: request.novelId,
    baseRevision: request.baseRevision,
    payload: operationPayload,
  })
  return createHash('sha256').update(JSON.stringify(hashInput)).digest('hex')
}

function assertReadyRegistry(novelId: string) {
  const registry = createControlDatabaseAccess().queryOne<RegistryRow>(
    'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
    novelId,
  )
  if (!registry) {
    throw new WorkspaceMutationError('novel_not_found', `Novel "${novelId}" was not found`, { novelId })
  }
  if (registry.migrationStatus !== 'ready') {
    throw new WorkspaceMutationError('novel_not_ready', `Novel "${novelId}" is not ready`, { novelId })
  }
}

function readReplay(db: DatabaseAccess, workspaceStateId: string, idempotencyKey: string) {
  return db.queryOne<ReplayRow>(
    `SELECT operation, requestHash, responseStatus, responseJson
     FROM WorkspaceMutationReplay
     WHERE workspaceStateId = ? AND idempotencyKey = ?`,
    workspaceStateId,
    idempotencyKey,
  )
}

function replayResult(row: ReplayRow): WorkspaceMutationResult {
  if (row.responseStatus !== 200) {
    throw new WorkspaceMutationError('persistence_failed', 'Stored workspace mutation replay is not a successful response')
  }
  try {
    const stored = JSON.parse(row.responseJson) as WorkspaceMutationResult
    return { ...stored, replayed: true, shouldScheduleKnowledgeSync: false }
  } catch (error) {
    throw new WorkspaceMutationError('persistence_failed', 'Stored workspace mutation replay is invalid', { cause: error })
  }
}

function hasRecoverableWorkspaceContent(db: DatabaseAccess, workspaceStateId: string) {
  const runtime = readWorkspaceRuntimeSnapshotFromDb(db, workspaceStateId)
  if (runtime && workspacePayloadHasLibraryContent(runtime.payload)) return true

  const artifact = readWorkspaceStateFromDb(db, workspaceStateId)
  if (artifact?.payload?.trim()) {
    try {
      if (workspacePayloadHasLibraryContent(normalizeWorkspaceState(JSON.parse(artifact.payload) as Partial<PersistedNovelState>))) {
        return true
      }
    } catch (error) {
      void error
    }
  }

  const novelCount = db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM NovelRecord')?.count ?? 0
  const chapterCount = db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeChapter')?.count ?? 0
  return novelCount > 0 && chapterCount > 0
}

function findChapter(db: DatabaseAccess, workspaceStateId: string, chapterId: string) {
  return db.queryOne<{ novelId: string }>(
    `SELECT novelId FROM WorkspaceRuntimeChapter
     WHERE workspaceStateId = ? AND id = ?`,
    workspaceStateId,
    chapterId,
  )
}

function applyChapterPatch(db: DatabaseAccess, request: ValidatedChapterPatch, nextRevision: number) {
  const chapter = findChapter(db, request.workspaceStateId, request.chapterId)
  if (!chapter || chapter.novelId !== request.novelId) {
    throw new WorkspaceMutationError('chapter_not_found', `Chapter "${request.chapterId}" was not found`, {
      novelId: request.novelId,
      workspaceStateId: request.workspaceStateId,
      chapterId: request.chapterId,
    })
  }
  db.execute(
    `UPDATE WorkspaceRuntimeChapter
     SET contentHtml = ?, wordCount = ?, updatedAtLabel = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE workspaceStateId = ? AND id = ? AND novelId = ?`,
    request.content,
    request.wordCount,
    request.updatedAtLabel,
    request.workspaceStateId,
    request.chapterId,
    request.novelId,
  )
  db.execute(
    `UPDATE WorkspaceRuntimeState
     SET revision = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
    nextRevision,
    request.workspaceStateId,
  )
}

function persistArtifactAndSync(
  db: DatabaseAccess,
  request: ValidatedWorkspaceMutation,
  payload: PersistedNovelState,
  updatedAt: string,
) {
  const serializedPayload = JSON.stringify(payload)
  const priorArtifact = readWorkspaceStateFromDb(db, request.workspaceStateId)
  if (priorArtifact && priorArtifact.payload !== null && priorArtifact.payload !== serializedPayload) {
    createWorkspaceStateBackupInDb(
      db,
      priorArtifact,
      request.kind === 'full-snapshot' ? request.backupReason : 'workspace-save',
    )
  }
  writeWorkspaceStateInDb(db, request.workspaceStateId, serializedPayload)
  pruneWorkspaceStateBackupsInDb(db, request.workspaceStateId)
  workspaceMutationFaultInjector?.('after_artifact')
  markWorkspaceKnowledgeSyncRequestedInDb(db, request.workspaceStateId, updatedAt)
  workspaceMutationFaultInjector?.('after_sync')
}

function insertReplayAndPrune(
  db: DatabaseAccess,
  request: ValidatedWorkspaceMutation,
  requestHash: string,
  result: WorkspaceMutationResult,
) {
  if (!request.idempotencyKey) return
  workspaceMutationFaultInjector?.('before_replay')
  db.execute(
    `INSERT INTO WorkspaceMutationReplay (
       workspaceStateId, idempotencyKey, operation, requestHash,
       committedRevision, responseStatus, responseJson
     ) VALUES (?, ?, ?, ?, ?, 200, ?)`,
    request.workspaceStateId,
    request.idempotencyKey,
    request.kind,
    requestHash,
    result.revision,
    JSON.stringify(result),
  )
  db.execute(
    `DELETE FROM WorkspaceMutationReplay
     WHERE workspaceStateId = ?
       AND idempotencyKey <> ?
       AND createdAt < datetime('now', ?)`,
    request.workspaceStateId,
    request.idempotencyKey,
    `-${REPLAY_RETENTION_DAYS} days`,
  )
  db.execute(
    `DELETE FROM WorkspaceMutationReplay
     WHERE workspaceStateId = ?
       AND idempotencyKey <> ?
       AND rowid NOT IN (
         SELECT rowid
         FROM WorkspaceMutationReplay
         WHERE workspaceStateId = ? AND idempotencyKey <> ?
         ORDER BY createdAt DESC, rowid DESC
         LIMIT ?
       )`,
    request.workspaceStateId,
    request.idempotencyKey,
    request.workspaceStateId,
    request.idempotencyKey,
    REPLAY_RETENTION_LIMIT - 1,
  )
}

function runMutationTransaction(db: DatabaseAccess, request: ValidatedWorkspaceMutation, requestHash: string) {
  if (request.idempotencyKey) {
    const replay = readReplay(db, request.workspaceStateId, request.idempotencyKey)
    if (replay) {
      if (replay.operation !== request.kind || replay.requestHash !== requestHash) {
        throw new WorkspaceMutationError('idempotency_key_reused', 'Idempotency key was already used for another mutation', {
          novelId: request.novelId,
          workspaceStateId: request.workspaceStateId,
        })
      }
      return replayResult(replay)
    }
  }

  const current = readWorkspaceRuntimeSnapshotFromDb(db, request.workspaceStateId)
  const currentRevision = current?.revision ?? 0
  if (request.kind === 'chapter-patch' && !current) {
    throw new WorkspaceMutationError('chapter_not_found', `Chapter "${request.chapterId}" was not found`, {
      novelId: request.novelId,
      workspaceStateId: request.workspaceStateId,
      chapterId: request.chapterId,
    })
  }
  if (request.baseRevision !== null && request.baseRevision !== currentRevision) {
    const chapter = request.kind === 'chapter-patch'
      ? current?.payload.localChapters.find((entry) => entry.id === request.chapterId) ?? null
      : null
    throw new WorkspaceMutationError('stale_revision', 'Workspace revision is stale', {
      novelId: request.novelId,
      workspaceStateId: request.workspaceStateId,
      chapterId: request.kind === 'chapter-patch' ? request.chapterId : undefined,
      currentRevision,
      chapter,
    })
  }
  if (
    request.kind === 'full-snapshot'
    && !request.allowEmptyReset
    && !workspacePayloadHasLibraryContent(request.payload)
    && hasRecoverableWorkspaceContent(db, request.workspaceStateId)
  ) {
    throw new WorkspaceMutationError('empty_overwrite_blocked', 'Refusing to overwrite a recoverable workspace with an empty payload', {
      novelId: request.novelId,
      workspaceStateId: request.workspaceStateId,
    })
  }

  const nextRevision = currentRevision + 1
  if (request.kind === 'chapter-patch') {
    applyChapterPatch(db, request, nextRevision)
  } else {
    replaceWorkspaceRuntimeStateInDb(db, request.payload, nextRevision, request.workspaceStateId)
  }
  workspaceMutationFaultInjector?.('after_runtime')

  const committedRuntime = readWorkspaceRuntimeSnapshotFromDb(db, request.workspaceStateId)
  if (!committedRuntime || committedRuntime.revision !== nextRevision) {
    throw new WorkspaceMutationError('persistence_failed', 'Workspace runtime mutation was not persisted')
  }
  persistArtifactAndSync(db, request, committedRuntime.payload, committedRuntime.updatedAt)

  const result: WorkspaceMutationResult = request.kind === 'chapter-patch'
    ? {
        ok: true,
        operation: request.kind,
        novelId: request.novelId,
        chapterId: request.chapterId,
        revision: nextRevision,
        updatedAt: committedRuntime.updatedAt,
        replayed: false,
        shouldScheduleKnowledgeSync: true,
      }
    : {
        ok: true,
        operation: request.kind,
        novelId: request.novelId,
        revision: nextRevision,
        updatedAt: committedRuntime.updatedAt,
        replayed: false,
        shouldScheduleKnowledgeSync: true,
      }
  insertReplayAndPrune(db, request, requestHash, result)
  return result
}

export async function runWorkspaceMutation(request: WorkspaceMutationRequest): Promise<WorkspaceMutationResult> {
  const validated = validateRequest(request)
  const requestHash = hashValidatedRequest(validated)

  return runWithPerNovelWriteGate(validated.novelId, async () => {
    assertReadyRegistry(validated.novelId)
    let db: DatabaseAccess
    try {
      db = createDatabaseAccess(getNovelDb(validated.novelId))
    } catch (error) {
      throw new WorkspaceMutationError('persistence_failed', 'Failed to open the novel workspace database', {
        novelId: validated.novelId,
        workspaceStateId: validated.workspaceStateId,
        cause: error,
      })
    }

    try {
      return await db.withTransaction(() => runMutationTransaction(db, validated, requestHash))
    } catch (error) {
      if (error instanceof WorkspaceMutationError) throw error
      throw new WorkspaceMutationError('persistence_failed', 'Workspace mutation failed', {
        novelId: validated.novelId,
        workspaceStateId: validated.workspaceStateId,
        cause: error,
      })
    }
  })
}

export async function createWorkspaceNovelFromSnapshot(params: {
  novelId: string
  payload: PersistedNovelState
  title?: string | null
  workspaceStateId?: string
  now?: Date | string
}): Promise<FullSnapshotMutationResult> {
  let novelId: string
  try {
    novelId = validateNovelId(params.novelId)
  } catch (error) {
    invalidContract(error instanceof Error ? error.message : 'Invalid novel ID', { cause: error })
  }
  const workspaceStateId = validateBoundedNonEmptyString(
    params.workspaceStateId ?? DEFAULT_WORKSPACE_STATE_ID,
    'workspaceStateId',
    MAX_WORKSPACE_STATE_ID_LENGTH,
  )
  const payload = scopeWorkspaceStateToNovel(normalizeWorkspaceState(params.payload), novelId)
  if (!workspacePayloadHasLibraryContent(payload)) {
    invalidContract('Imported workspace payload must contain novel or chapter content', { novelId, workspaceStateId })
  }

  return runWithPerNovelWriteGate(novelId, async () => {
    const storagePaths = getNovelStoragePaths(novelId)
    const registry = createControlDatabaseAccess().queryOne<RegistryRow>(
      'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
      novelId,
    )
    if (registry || fs.existsSync(storagePaths.novelDirectory) || fs.existsSync(storagePaths.quarantinePath)) {
      throw new WorkspaceMutationError('novel_not_ready', `Novel "${novelId}" already exists or has reserved storage`, { novelId, workspaceStateId })
    }

    let creationStarted = false
    let creatorToken: string | null = null
    try {
      creatorToken = await beginWorkspaceNovelCreation({
        novelId,
        title: params.title ?? payload.localNovels[0]?.title ?? null,
        now: params.now,
      })
      creationStarted = true
      await renewWorkspaceNovelCreation(novelId, creatorToken, params.now)
      const db = createCreatingNovelDatabaseAccess(novelId)
      const result = await db.withTransaction(() => {
        replaceWorkspaceRuntimeStateInDb(db, payload, 1, workspaceStateId)
        const committedRuntime = readWorkspaceRuntimeSnapshotFromDb(db, workspaceStateId)
        if (!committedRuntime || committedRuntime.revision !== 1) {
          throw new WorkspaceMutationError('persistence_failed', 'Imported workspace runtime was not persisted', { novelId, workspaceStateId })
        }
        const request: ValidatedFullSnapshot = {
          kind: 'full-snapshot',
          novelId,
          workspaceStateId,
          payload,
          backupReason: 'import-txt',
          allowEmptyReset: false,
          baseRevision: null,
          idempotencyKey: null,
        }
        persistArtifactAndSync(db, request, committedRuntime.payload, committedRuntime.updatedAt)
        return {
          ok: true,
          operation: 'full-snapshot',
          novelId,
          revision: 1,
          updatedAt: committedRuntime.updatedAt,
          replayed: false,
          shouldScheduleKnowledgeSync: false,
        } satisfies FullSnapshotMutationResult
      })
      await renewWorkspaceNovelCreation(novelId, creatorToken, params.now)
      const claimedSync = claimPendingWorkspaceKnowledgeSync(workspaceStateId, { db })
      if (!claimedSync || claimedSync.revision !== 1) {
        throw new WorkspaceMutationError('persistence_failed', 'Imported workspace knowledge sync request was not claimable', {
          novelId,
          workspaceStateId,
        })
      }
      try {
        const syncPayload = loadWorkspaceKnowledgeSyncPayload(claimedSync.workspaceStateId, db)
        const scopedSyncPayload = syncPayload
          ? { ...syncPayload, syncScope: 'target-novel' as const }
          : {
              localNovels: [],
              localChapters: [],
              currentNovelId: '',
              syncScope: 'target-novel' as const,
            } satisfies WorkspaceKnowledgeSyncPayload
        await runWithCreatingNovelResolution(novelId, () => (
          syncWorkspacePayloadToKnowledgeStore(scopedSyncPayload, { db })
        ))
        completeWorkspaceKnowledgeSync(claimedSync, { db })
      } catch (syncError) {
        failWorkspaceKnowledgeSync(
          claimedSync,
          syncError instanceof Error ? syncError.message : 'Unknown workspace knowledge sync failure',
          { db },
        )
        throw syncError
      }
      await renewWorkspaceNovelCreation(novelId, creatorToken, params.now)
      workspaceNovelCreationFaultInjector?.()
      await publishWorkspaceNovelCreation(novelId, creatorToken, params.now)
      return result
    } catch (error) {
      if (creationStarted && creatorToken) {
        try {
          await abortWorkspaceNovelCreation(novelId, creatorToken, params.now)
        } catch (cleanupError) {
          console.error('Failed to compensate workspace novel creation:', novelId, cleanupError)
        }
      }
      if (error instanceof WorkspaceMutationError) throw error
      throw new WorkspaceMutationError('persistence_failed', 'Workspace novel creation failed', {
        novelId,
        workspaceStateId,
        cause: error,
      })
    }
  })
}
