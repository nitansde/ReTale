import fs from 'node:fs'
import path from 'node:path'
import { safeParseJson } from '@/lib/server/json-parse'
import { PROTECTED_RESET_APP_SETTING_KEYS } from '@/lib/server/schema'
import {
  createControlDatabaseAccess,
  createNovelDatabaseAccess,
  execute,
  queryAll,
  type DatabaseAccess,
  withTransaction,
} from '@/lib/server/database-access'
import {
  evictNovelStorageCache,
  getNovelStoragePaths,
  purgeNovelQuarantine,
  quarantineNovelStorage,
  validateNovelDeletionPaths,
  validateNovelId,
} from '@/lib/server/db-resolver'
import { runWithPerNovelWriteGate } from '@/lib/server/per-novel-write-gate'
import { parseScopedWorkspacePayload } from '@/lib/server/workspace-novel-scope'

type WorkspaceStateRow = {
  id: string
  payload: string | null
  createdAt: string
  updatedAt: string
}

type WorkspaceStateBackupRow = {
  id: string
  workspaceStateId: string
  payload: string | null
  reason: string
  sourceUpdatedAt: string | null
  createdAt: string
}

type WorkspaceStateWriteOptions = {
  backupReason?: string
  novelId?: string
  db?: DatabaseAccess
}

type WorkspaceDbContext = {
  novelId?: string
  db?: DatabaseAccess
}

type WorkspaceKnowledgeSyncStateRow = {
  workspaceStateId: string
  requestedRevision: number
  startedRevision: number | null
  syncedRevision: number
  requestedSourceUpdatedAt: string | null
  startedSourceUpdatedAt: string | null
  startedAt: string | null
  syncedSourceUpdatedAt: string | null
  lastError: string | null
}

export type WorkspaceKnowledgeSyncClaim = {
  workspaceStateId: string
  revision: number
  sourceUpdatedAt: string
}

type AppSettingRow = {
  id: string
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceNovelRegistryRow = {
  novelId: string
  safeNovelId: string
  title: string | null
  dbFilePath: string
  lanceDbPath: string
  schemaVersion: string
  migrationStatus: 'ready' | 'deleting' | 'deleted' | string
  createdAt: string
  updatedAt: string
}

export class WorkspaceNovelDeletionError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message)
    this.name = 'WorkspaceNovelDeletionError'
  }
}

export class WorkspaceNovelStateConflictError extends Error {
  readonly status = 409

  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceNovelStateConflictError'
  }
}

export type WorkspaceNovelDeletionResult = {
  deletedNovelId: string
  activeNovelId: string | null
  deletionState: 'deleted'
  cleanupPending: boolean
}

export type WorkspaceNovelDeletionState = 'ready' | 'deleting' | 'deleted'

type SqliteTableRow = {
  name: string
}

const [PRESET_COMPAT_LIBRARY_V1_KEY, AI_SETTINGS_V2_KEY, OLLAMA_TIMEOUT_MS_KEY] = PROTECTED_RESET_APP_SETTING_KEYS
const WORKSPACE_BACKUP_RETENTION = 20
const WORKSPACE_KNOWLEDGE_SYNC_STALE_MS = 5 * 60 * 1000
const WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT = 25
let workspaceNovelCleanupScanCursor: Pick<WorkspaceNovelRegistryRow, 'migrationStatus' | 'updatedAt' | 'novelId'> | null = null
const ACTIVE_WORKSPACE_NOVEL_ID_KEY = 'WORKSPACE_ACTIVE_NOVEL_ID'

export type ProtectedAppSettingsResetSnapshot = {
  presetCompatLibraryV1: string | null
  aiSettingsV2: string | null
  ollamaTimeoutMs: string | null
}

function getNovelDatabaseAccess(novelId: string) {
  return createNovelDatabaseAccess(novelId)
}

function resolveWorkspaceDbContext(context: WorkspaceDbContext = {}) {
  if (context.db) {
    return context.db
  }

  const novelId = context.novelId ?? readActiveWorkspaceNovelId()
  if (!novelId) {
    return null
  }

  return getNovelDatabaseAccess(novelId)
}

export function readActiveWorkspaceNovelId() {
  return createControlDatabaseAccess().queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', ACTIVE_WORKSPACE_NOVEL_ID_KEY)?.value ?? null
}

function upsertActiveWorkspaceNovelId(controlDb: DatabaseAccess, novelId: string) {
  controlDb.execute(
    `INSERT INTO AppSetting (id, key, value)
     VALUES (lower(hex(randomblob(16))), ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       id = excluded.id,
       value = excluded.value,
       updatedAt = CURRENT_TIMESTAMP`,
    ACTIVE_WORKSPACE_NOVEL_ID_KEY,
    novelId,
  )
  const published = controlDb.queryOne<AppSettingRow>(
    'SELECT id, key, value, createdAt, updatedAt FROM AppSetting WHERE key = ?',
    ACTIVE_WORKSPACE_NOVEL_ID_KEY,
  )
  if (!published) {
    throw new Error('Failed to publish the active workspace novel')
  }
  return published
}

export function writeActiveWorkspaceNovelId(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  upsertActiveWorkspaceNovelId(createControlDatabaseAccess(), stableNovelId)
}

export function readWorkspaceNovelDeletionState(novelId: string): WorkspaceNovelDeletionState {
  let stableNovelId: string
  try {
    stableNovelId = validateNovelId(novelId)
  } catch (error) {
    throw new WorkspaceNovelDeletionError(error instanceof Error ? error.message : 'Invalid novel ID', 400)
  }

  const row = createControlDatabaseAccess().queryOne<{ migrationStatus: string }>(
    'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
    stableNovelId,
  )
  if (!row) {
    throw new WorkspaceNovelDeletionError('Novel not found', 404)
  }
  if (!['ready', 'deleting', 'deleted'].includes(row.migrationStatus)) {
    throw new WorkspaceNovelDeletionError('Novel deletion state is unavailable', 409)
  }
  return row.migrationStatus as WorkspaceNovelDeletionState
}

export function upsertWorkspaceNovelRegistry(params: { novelId: string; title?: string | null }) {
  const controlDb = createControlDatabaseAccess()
  const paths = getNovelStoragePaths(params.novelId)
  controlDb.execute(
    `INSERT INTO NovelRegistry (
       novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
     ) VALUES (?, ?, ?, ?, ?, '1', 'ready')
     ON CONFLICT(novelId) DO UPDATE SET
       title = COALESCE(excluded.title, NovelRegistry.title),
        dbFilePath = excluded.dbFilePath,
        lanceDbPath = excluded.lanceDbPath,
        schemaVersion = excluded.schemaVersion,
        updatedAt = CURRENT_TIMESTAMP
      WHERE NovelRegistry.migrationStatus = 'ready'`,
    params.novelId,
    params.novelId,
    params.title?.trim() || null,
    paths.databasePath,
    paths.lanceDbPath,
  )
}

export function assertWorkspaceNovelReadyForWrite(novelId: string) {
  const row = createControlDatabaseAccess().queryOne<{ migrationStatus: string }>(
    'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
    novelId,
  )
  if (row && row.migrationStatus !== 'ready') {
    throw new WorkspaceNovelStateConflictError('Novel deletion is already in progress or complete')
  }
}

export function listReadyWorkspaceNovelRegistry() {
  return createControlDatabaseAccess().queryAll<WorkspaceNovelRegistryRow>(
    `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus, createdAt, updatedAt
     FROM NovelRegistry
     WHERE migrationStatus = 'ready'
     ORDER BY createdAt ASC, novelId ASC`
  )
}

function assertCanonicalRegistryStoragePaths(row: WorkspaceNovelRegistryRow) {
  const expectedPaths = getNovelStoragePaths(row.novelId)
  if (
    row.safeNovelId !== row.novelId
    || path.resolve(row.dbFilePath) !== path.resolve(expectedPaths.databasePath)
    || path.resolve(row.lanceDbPath) !== path.resolve(expectedPaths.lanceDbPath)
  ) {
    throw new Error(`Novel registry storage paths do not match the canonical paths for "${row.novelId}"`)
  }
}

function findWorkspaceNovelRegistryRow(novelId: string) {
  return createControlDatabaseAccess().queryOne<WorkspaceNovelRegistryRow>(
    `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus, createdAt, updatedAt
     FROM NovelRegistry
     WHERE novelId = ?`,
    novelId,
  )
}

async function cleanupWorkspaceNovelUnderGate(
  novelId: string,
  readyCompensation: {
    target: WorkspaceNovelRegistryRow
    activeSettingBefore: AppSettingRow | null
    activeSettingPublished: AppSettingRow | null
  } | null = null,
) {
  const controlDb = createControlDatabaseAccess()
  const target = findWorkspaceNovelRegistryRow(novelId)
  if (!target || !['deleting', 'deleted'].includes(target.migrationStatus)) {
    return null
  }

  const storagePaths = validateNovelDeletionPaths(novelId)
  assertCanonicalRegistryStoragePaths(target)

  try {
    evictNovelStorageCache(novelId)
    quarantineNovelStorage(storagePaths)
  } catch (error) {
    if (readyCompensation && fs.existsSync(storagePaths.novelDirectory)) {
      await controlDb.withTransaction(() => {
        const compensated = controlDb.execute(
          `UPDATE NovelRegistry
           SET safeNovelId = ?, title = ?, dbFilePath = ?, lanceDbPath = ?, schemaVersion = ?,
               migrationStatus = ?, createdAt = ?, updatedAt = ?
           WHERE novelId = ? AND migrationStatus = 'deleting'`,
          readyCompensation.target.safeNovelId,
          readyCompensation.target.title,
          readyCompensation.target.dbFilePath,
          readyCompensation.target.lanceDbPath,
          readyCompensation.target.schemaVersion,
          readyCompensation.target.migrationStatus,
          readyCompensation.target.createdAt,
          readyCompensation.target.updatedAt,
          novelId,
        )
        if (compensated.changes !== 1) {
          return
        }

        const before = readyCompensation.activeSettingBefore
        const published = readyCompensation.activeSettingPublished
        if (before && published) {
          controlDb.execute(
            `UPDATE AppSetting
             SET id = ?, value = ?, createdAt = ?, updatedAt = ?
             WHERE key = ? AND id = ?`,
            before.id,
            before.value,
            before.createdAt,
            before.updatedAt,
            ACTIVE_WORKSPACE_NOVEL_ID_KEY,
            published.id,
          )
        } else if (before) {
          controlDb.execute(
            `INSERT INTO AppSetting (id, key, value, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(key) DO NOTHING`,
            before.id,
            before.key,
            before.value,
            before.createdAt,
            before.updatedAt,
          )
        } else if (published) {
          controlDb.execute(
            'DELETE FROM AppSetting WHERE key = ? AND id = ?',
            ACTIVE_WORKSPACE_NOVEL_ID_KEY,
            published.id,
          )
        }
      })
    }
    throw error
  }

  if (target.migrationStatus === 'deleting') {
    await controlDb.withTransaction(() => {
      controlDb.execute(
        `UPDATE NovelRegistry
         SET migrationStatus = 'deleted', updatedAt = CURRENT_TIMESTAMP
         WHERE novelId = ? AND migrationStatus = 'deleting'`,
        novelId,
      )
      const committed = controlDb.queryOne<{ migrationStatus: string }>(
        'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
        novelId,
      )
      if (committed?.migrationStatus !== 'deleted') {
        throw new Error(`Failed to finalize deletion tombstone for "${novelId}"`)
      }
    })
  }

  let cleanupPending = false
  try {
    purgeNovelQuarantine(storagePaths)
  } catch (error) {
    cleanupPending = true
    console.error('Failed to purge quarantined novel storage:', error)
  }

  return { cleanupPending }
}

export async function resumeWorkspaceNovelCleanup(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  return runWithPerNovelWriteGate(stableNovelId, () => cleanupWorkspaceNovelUnderGate(stableNovelId))
}

export async function resumePendingWorkspaceNovelCleanup() {
  const controlDb = createControlDatabaseAccess()
  const cursor = workspaceNovelCleanupScanCursor
  const rows = cursor
    ? controlDb.queryAll<WorkspaceNovelRegistryRow>(
        `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus, createdAt, updatedAt
         FROM NovelRegistry
         WHERE migrationStatus IN ('deleting', 'deleted')
           AND (
             CASE migrationStatus WHEN 'deleting' THEN 0 ELSE 1 END > ?
             OR (CASE migrationStatus WHEN 'deleting' THEN 0 ELSE 1 END = ? AND updatedAt > ?)
             OR (CASE migrationStatus WHEN 'deleting' THEN 0 ELSE 1 END = ? AND updatedAt = ? AND novelId > ?)
           )
         ORDER BY CASE migrationStatus WHEN 'deleting' THEN 0 ELSE 1 END, updatedAt ASC, novelId ASC
         LIMIT ?`,
        cursor.migrationStatus === 'deleting' ? 0 : 1,
        cursor.migrationStatus === 'deleting' ? 0 : 1,
        cursor.updatedAt,
        cursor.migrationStatus === 'deleting' ? 0 : 1,
        cursor.updatedAt,
        cursor.novelId,
        WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT,
      )
    : controlDb.queryAll<WorkspaceNovelRegistryRow>(
        `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus, createdAt, updatedAt
         FROM NovelRegistry
         WHERE migrationStatus IN ('deleting', 'deleted')
         ORDER BY CASE migrationStatus WHEN 'deleting' THEN 0 ELSE 1 END, updatedAt ASC, novelId ASC
         LIMIT ?`,
        WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT,
      )

  if (!rows.length) {
    workspaceNovelCleanupScanCursor = null
    return
  }

  workspaceNovelCleanupScanCursor = rows.length < WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT
    ? null
    : rows.at(-1) ?? null

  for (const row of rows) {
    try {
      if (row.migrationStatus === 'deleted') {
        const storagePaths = getNovelStoragePaths(row.novelId)
        if (!fs.existsSync(storagePaths.novelDirectory) && !fs.existsSync(storagePaths.quarantinePath)) {
          continue
        }
      }

      await resumeWorkspaceNovelCleanup(row.novelId)
    } catch (error) {
      console.error('Failed to resume quarantined novel cleanup:', row.novelId, error)
    }
  }
}

export async function deleteWorkspaceNovel(params: {
  novelId: string
  nextNovelId?: string | null
}): Promise<WorkspaceNovelDeletionResult> {
  let novelId: string
  try {
    novelId = validateNovelId(params.novelId)
  } catch (error) {
    throw new WorkspaceNovelDeletionError(error instanceof Error ? error.message : 'Invalid novel ID', 400)
  }

  let requestedNextNovelId: string | null = null
  if (params.nextNovelId !== undefined && params.nextNovelId !== null) {
    try {
      requestedNextNovelId = validateNovelId(params.nextNovelId)
    } catch (error) {
      throw new WorkspaceNovelDeletionError(error instanceof Error ? error.message : 'Invalid survivor novel ID', 409)
    }

    if (requestedNextNovelId === novelId) {
      throw new WorkspaceNovelDeletionError('The survivor novel must differ from the deleted novel', 409)
    }
  }

  return runWithPerNovelWriteGate(novelId, async () => {
    const controlDb = createControlDatabaseAccess()
    const target = findWorkspaceNovelRegistryRow(novelId)
    if (!target) {
      throw new WorkspaceNovelDeletionError('Novel not found', 404)
    }
    if (!['ready', 'deleting', 'deleted'].includes(target.migrationStatus)) {
      throw new WorkspaceNovelDeletionError('Novel not found', 404)
    }

    const storagePaths = validateNovelDeletionPaths(novelId)
    assertCanonicalRegistryStoragePaths(target)

    let nextActiveNovelId = readActiveWorkspaceNovelId()
    let readyCompensation: {
      target: WorkspaceNovelRegistryRow
      activeSettingBefore: AppSettingRow | null
      activeSettingPublished: AppSettingRow | null
    } | null = null

    if (target.migrationStatus === 'ready') {
      if (fs.existsSync(storagePaths.databasePath)) {
        const novelDb = getNovelDatabaseAccess(novelId)
        const activeJob = novelDb.queryOne<{ status: string }>(
          `SELECT status FROM KnowledgeJob
           WHERE status IN ('queued', 'running', 'paused')
           LIMIT 1`,
        )
        if (activeJob) {
          throw new WorkspaceNovelDeletionError(`Novel has active knowledge work (${activeJob.status})`, 409)
        }
        const activeSync = novelDb.queryOne<{ requestedRevision: number; syncedRevision: number; startedRevision: number | null }>(
          `SELECT requestedRevision, syncedRevision, startedRevision
           FROM WorkspaceKnowledgeSyncState
           WHERE requestedRevision > syncedRevision OR startedRevision IS NOT NULL
           LIMIT 1`,
        )
        if (activeSync) {
          throw new WorkspaceNovelDeletionError('Novel has pending workspace knowledge synchronization', 409)
        }
      }

      const transition = await controlDb.withTransaction(() => {
        const currentTarget = findWorkspaceNovelRegistryRow(novelId)
        if (!currentTarget || currentTarget.migrationStatus !== 'ready') {
          throw new WorkspaceNovelDeletionError('Novel deletion is already in progress or complete', 409)
        }
        const survivors = controlDb.queryAll<WorkspaceNovelRegistryRow>(
          `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus, createdAt, updatedAt
           FROM NovelRegistry
           WHERE novelId != ? AND migrationStatus = 'ready'
           ORDER BY createdAt ASC, novelId ASC`,
          novelId,
        )
        const requestedSurvivor = requestedNextNovelId
          ? survivors.find((row) => row.novelId === requestedNextNovelId) ?? null
          : null
        if (requestedNextNovelId && !requestedSurvivor) {
          throw new WorkspaceNovelDeletionError('The requested survivor novel is not available', 409)
        }
        const activeSetting = controlDb.queryOne<AppSettingRow>(
          'SELECT id, key, value, createdAt, updatedAt FROM AppSetting WHERE key = ?',
          ACTIVE_WORKSPACE_NOVEL_ID_KEY,
        )
        const activeSurvivor = survivors.find((row) => row.novelId === activeSetting?.value) ?? null
        const canonicalActiveNovelId = activeSurvivor?.novelId
          ?? requestedSurvivor?.novelId
          ?? survivors[0]?.novelId
          ?? null
        const canonicalActiveSurvivor = survivors.find((row) => row.novelId === canonicalActiveNovelId) ?? null
        if (canonicalActiveSurvivor) {
          assertCanonicalRegistryStoragePaths(canonicalActiveSurvivor)
        }

        controlDb.execute(
          `UPDATE NovelRegistry
           SET migrationStatus = 'deleting', updatedAt = CURRENT_TIMESTAMP
           WHERE novelId = ? AND migrationStatus = 'ready'`,
          novelId,
        )
        const activeSettingPublished = canonicalActiveNovelId
          ? upsertActiveWorkspaceNovelId(controlDb, canonicalActiveNovelId)
          : null
        if (!canonicalActiveNovelId) {
          controlDb.execute('DELETE FROM AppSetting WHERE key = ?', ACTIVE_WORKSPACE_NOVEL_ID_KEY)
        }
        return {
          activeNovelId: canonicalActiveNovelId,
          compensation: {
            target: currentTarget,
            activeSettingBefore: activeSetting,
            activeSettingPublished,
          },
        }
      })
      nextActiveNovelId = transition.activeNovelId
      readyCompensation = transition.compensation
    }

    const cleanup = await cleanupWorkspaceNovelUnderGate(novelId, readyCompensation)
    if (!cleanup) {
      throw new WorkspaceNovelDeletionError('Novel deletion is already in progress or complete', 409)
    }

    return {
      deletedNovelId: novelId,
      activeNovelId: nextActiveNovelId,
      deletionState: 'deleted',
      cleanupPending: cleanup.cleanupPending,
    }
  })
}

export function findWorkspaceState(id = 'singleton', context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) return null
  return db.queryOne<WorkspaceStateRow>('SELECT id, payload, createdAt, updatedAt FROM WorkspaceState WHERE id = ?', id)
}

export function findWorkspaceStateBackups(id = 'singleton', context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) return [] as WorkspaceStateBackupRow[]
  return db.queryAll<WorkspaceStateBackupRow>(
    `SELECT id, workspaceStateId, payload, reason, sourceUpdatedAt, createdAt
     FROM WorkspaceStateBackup
     WHERE workspaceStateId = ?
     ORDER BY createdAt DESC, rowid DESC`,
    id
  )
}

export function createWorkspaceState(id: string, payload: string, context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot create workspace state without a target novel database')
  }

  db.execute('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)', id, payload)
  const created = findWorkspaceState(id, { db })
  if (!created) {
    throw new Error('Failed to create workspace state')
  }
  return created
}

function createWorkspaceStateBackup(db: DatabaseAccess, row: WorkspaceStateRow, reason: string) {
  db.execute(
    `INSERT INTO WorkspaceStateBackup (id, workspaceStateId, payload, reason, sourceUpdatedAt)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
    row.id,
    row.payload,
    reason,
    row.updatedAt
  )
}

function pruneWorkspaceStateBackups(db: DatabaseAccess, id: string) {
  db.execute(
    `DELETE FROM WorkspaceStateBackup
     WHERE workspaceStateId = ?
       AND id NOT IN (
         SELECT id
         FROM WorkspaceStateBackup
         WHERE workspaceStateId = ?
         ORDER BY createdAt DESC, rowid DESC
         LIMIT ?
       )`,
    id,
    id,
    WORKSPACE_BACKUP_RETENTION
  )
}

export function upsertWorkspaceState(id: string, payload: string, options: WorkspaceStateWriteOptions = {}) {
  const scopedPayload = options.db || options.novelId
    ? { serializedPayload: payload, novelId: options.novelId ?? null, title: null as string | null }
    : (() => {
        const parsed = parseScopedWorkspacePayload(payload)
        return {
          serializedPayload: JSON.stringify(parsed.scoped),
          novelId: parsed.novelId,
          title: parsed.scoped.localNovels[0]?.title ?? null,
        }
      })()

  const novelId = options.novelId ?? scopedPayload.novelId ?? readActiveWorkspaceNovelId()
  if (!novelId && !options.db) {
    throw new Error('Cannot save workspace payload without a target novel')
  }

  if (novelId) {
    assertWorkspaceNovelReadyForWrite(novelId)
    writeActiveWorkspaceNovelId(novelId)
    upsertWorkspaceNovelRegistry({ novelId, title: scopedPayload.title })
  }

  const db = options.db ?? (novelId ? getNovelDatabaseAccess(novelId) : null)
  if (!db) {
    throw new Error('Cannot save workspace payload without a novel database')
  }

  db.execute('BEGIN IMMEDIATE')
  try {
    const existing = findWorkspaceState(id, { db })
    if (existing && existing.payload !== scopedPayload.serializedPayload) {
      createWorkspaceStateBackup(db, existing, options.backupReason ?? 'overwrite')
    }

    db.execute(
      `
        INSERT INTO WorkspaceState (id, payload)
        VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload,
          updatedAt = CURRENT_TIMESTAMP
      `,
      id,
      scopedPayload.serializedPayload
    )

    pruneWorkspaceStateBackups(db, id)
    db.execute('COMMIT')
  } catch (error) {
    try {
      db.execute('ROLLBACK')
    } catch (_rollbackError) {
      void _rollbackError
      // Ignore rollback cleanup failures so the original transaction error is rethrown.
    }
    throw error
  }

  const saved = findWorkspaceState(id, { db })
  if (!saved) {
    throw new Error('Failed to save workspace state')
  }
  return saved
}

function findWorkspaceKnowledgeSyncState(id: string, db: DatabaseAccess) {
  return db.queryOne<WorkspaceKnowledgeSyncStateRow>(
    `SELECT workspaceStateId, requestedRevision, startedRevision, syncedRevision,
            requestedSourceUpdatedAt, startedSourceUpdatedAt, startedAt, syncedSourceUpdatedAt, lastError
     FROM WorkspaceKnowledgeSyncState
     WHERE workspaceStateId = ?`,
    id
  )
}

function parseSqliteTimestamp(value: string | null) {
  if (!value) return Number.NaN
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/u.test(normalized) ? normalized : `${normalized}Z`)
}

function hasFreshWorkspaceKnowledgeSyncStart(startedAt: string | null) {
  const startedAtMs = parseSqliteTimestamp(startedAt)
  if (!Number.isFinite(startedAtMs)) return false
  return Date.now() - startedAtMs < WORKSPACE_KNOWLEDGE_SYNC_STALE_MS
}

export function markWorkspaceKnowledgeSyncRequested(id: string, sourceUpdatedAt: string, context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot queue workspace knowledge sync without a target novel database')
  }

  db.execute(
    `INSERT INTO WorkspaceKnowledgeSyncState (
       workspaceStateId,
       requestedRevision,
       requestedSourceUpdatedAt,
       startedSourceUpdatedAt,
       startedAt,
       syncedSourceUpdatedAt,
       lastError
     ) VALUES (?, 1, ?, NULL, NULL, NULL, NULL)
     ON CONFLICT(workspaceStateId) DO UPDATE SET
       requestedRevision = WorkspaceKnowledgeSyncState.requestedRevision + 1,
       requestedSourceUpdatedAt = excluded.requestedSourceUpdatedAt,
       updatedAt = CURRENT_TIMESTAMP`,
     id,
     sourceUpdatedAt
   )
}

export function claimPendingWorkspaceKnowledgeSync(id = 'singleton', context: WorkspaceDbContext = {}): WorkspaceKnowledgeSyncClaim | null {
  const db = resolveWorkspaceDbContext(context)
  if (!db) return null

  db.execute('BEGIN IMMEDIATE')
  try {
    const syncState = findWorkspaceKnowledgeSyncState(id, db)
    const requestedSourceUpdatedAt = syncState?.requestedSourceUpdatedAt ?? null
    const requestedRevision = syncState?.requestedRevision ?? 0

    if (!requestedSourceUpdatedAt || requestedRevision <= (syncState?.syncedRevision ?? 0)) {
      db.execute('ROLLBACK')
      return null
    }

    if (
      syncState?.startedRevision === requestedRevision
      && hasFreshWorkspaceKnowledgeSyncStart(syncState.startedAt)
    ) {
      db.execute('ROLLBACK')
      return null
    }

    db.execute(
      `INSERT INTO WorkspaceKnowledgeSyncState (
         workspaceStateId,
         requestedRevision,
         startedRevision,
         syncedRevision,
         requestedSourceUpdatedAt,
         startedSourceUpdatedAt,
         startedAt,
         syncedSourceUpdatedAt,
         lastError
       ) VALUES (?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP, NULL, NULL)
       ON CONFLICT(workspaceStateId) DO UPDATE SET
         startedRevision = excluded.startedRevision,
         startedSourceUpdatedAt = excluded.startedSourceUpdatedAt,
         startedAt = CURRENT_TIMESTAMP,
         lastError = NULL,
         updatedAt = CURRENT_TIMESTAMP`,
      id,
      requestedRevision,
      requestedRevision,
      requestedSourceUpdatedAt,
      requestedSourceUpdatedAt
    )

    db.execute('COMMIT')
    return {
      workspaceStateId: id,
      revision: requestedRevision,
      sourceUpdatedAt: requestedSourceUpdatedAt,
    }
  } catch (error) {
    try {
      db.execute('ROLLBACK')
    } catch (_rollbackError) {
      void _rollbackError
      // Ignore rollback cleanup failures so the original transaction error is rethrown.
    }
    throw error
  }
}

export function completeWorkspaceKnowledgeSync(id: string, revision: number, sourceUpdatedAt: string, context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot complete workspace knowledge sync without a target novel database')
  }

  db.execute(
    `UPDATE WorkspaceKnowledgeSyncState
     SET syncedRevision = ?,
         syncedSourceUpdatedAt = ?,
         startedRevision = NULL,
         startedSourceUpdatedAt = NULL,
         startedAt = NULL,
         lastError = NULL,
         updatedAt = CURRENT_TIMESTAMP
     WHERE workspaceStateId = ?`,
    revision,
    sourceUpdatedAt,
    id
  )
}

export function failWorkspaceKnowledgeSync(id: string, errorMessage: string, context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot fail workspace knowledge sync without a target novel database')
  }

  db.execute(
    `UPDATE WorkspaceKnowledgeSyncState
     SET startedRevision = NULL,
         startedSourceUpdatedAt = NULL,
         startedAt = NULL,
         lastError = ?,
         updatedAt = CURRENT_TIMESTAMP
     WHERE workspaceStateId = ?`,
    errorMessage,
    id
  )
}

export function findAppSettings(keys: readonly string[]) {
  if (!keys.length) return [] as AppSettingRow[]
  const controlDb = createControlDatabaseAccess()
  const placeholders = keys.map(() => '?').join(', ')
  return controlDb.queryAll<AppSettingRow>(
    `SELECT id, key, value, createdAt, updatedAt FROM AppSetting WHERE key IN (${placeholders})`,
    ...keys
  )
}

export async function upsertAppSettings(entries: ReadonlyArray<readonly [string, string]>) {
  const controlDb = createControlDatabaseAccess()
  await controlDb.withTransaction(async () => {
    for (const [key, value] of entries) {
      controlDb.execute(
        `
          INSERT INTO AppSetting (id, key, value)
          VALUES (lower(hex(randomblob(16))), ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updatedAt = CURRENT_TIMESTAMP
        `,
        key,
        value
      )
    }
  })
}

function quoteSqlIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonBlob(value: string | null) {
  return safeParseJson(value)
}

function isPositiveIntegerString(value: string) {
  return /^[1-9]\d*$/.test(value.trim())
}

function readProtectedAppSettingsResetSnapshot(controlDb: DatabaseAccess): ProtectedAppSettingsResetSnapshot {
  const placeholders = PROTECTED_RESET_APP_SETTING_KEYS.map(() => '?').join(', ')
  const entries = controlDb.queryAll<AppSettingRow>(
    `SELECT id, key, value, createdAt, updatedAt FROM AppSetting WHERE key IN (${placeholders})`,
    ...PROTECTED_RESET_APP_SETTING_KEYS
  )
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value])) as Partial<Record<(typeof PROTECTED_RESET_APP_SETTING_KEYS)[number], string>>
  return {
    presetCompatLibraryV1: map.PRESET_COMPAT_LIBRARY_V1 ?? null,
    aiSettingsV2: map.AI_SETTINGS_V2 ?? null,
    ollamaTimeoutMs: map.OLLAMA_TIMEOUT_MS ?? null,
  }
}

function validateProtectedAppSettingsResetSnapshot(snapshot: ProtectedAppSettingsResetSnapshot) {
  if (snapshot.presetCompatLibraryV1 !== null && !isRecord(parseJsonBlob(snapshot.presetCompatLibraryV1))) {
    throw new Error('Protected reset snapshot for PRESET_COMPAT_LIBRARY_V1 is invalid')
  }

  if (snapshot.aiSettingsV2 !== null && parseJsonBlob(snapshot.aiSettingsV2) === null) {
    throw new Error('Protected reset snapshot for AI_SETTINGS_V2 is invalid')
  }

  if (snapshot.ollamaTimeoutMs !== null && !isPositiveIntegerString(snapshot.ollamaTimeoutMs)) {
    throw new Error('Protected reset snapshot for OLLAMA_TIMEOUT_MS is invalid')
  }
}

function listResettableTables() {
  return queryAll<SqliteTableRow>(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name != 'AppSetting'
      ORDER BY name ASC
    `
  ).map((row) => row.name)
}

function clearBusinessDataTables() {
  const tables = listResettableTables()
  execute('PRAGMA foreign_keys = OFF')
  try {
    for (const tableName of tables) {
      execute(`DELETE FROM ${quoteSqlIdentifier(tableName)}`)
    }
  } finally {
    execute('PRAGMA foreign_keys = ON')
  }
}

function clearNonProtectedAppSettings(controlDb: DatabaseAccess) {
  const placeholders = PROTECTED_RESET_APP_SETTING_KEYS.map(() => '?').join(', ')
  controlDb.execute(
    `DELETE FROM AppSetting WHERE key NOT IN (${placeholders})`,
    ...PROTECTED_RESET_APP_SETTING_KEYS
  )
}

function restoreProtectedAppSettings(controlDb: DatabaseAccess, snapshot: ProtectedAppSettingsResetSnapshot) {
  const nextEntries: Array<readonly [string, string]> = []
  if (snapshot.presetCompatLibraryV1 !== null) {
    nextEntries.push([PRESET_COMPAT_LIBRARY_V1_KEY, snapshot.presetCompatLibraryV1])
  }
  if (snapshot.aiSettingsV2 !== null) {
    nextEntries.push([AI_SETTINGS_V2_KEY, snapshot.aiSettingsV2])
  }
  if (snapshot.ollamaTimeoutMs !== null) {
    nextEntries.push([OLLAMA_TIMEOUT_MS_KEY, snapshot.ollamaTimeoutMs])
  }

  for (const key of PROTECTED_RESET_APP_SETTING_KEYS) {
    const shouldExist = nextEntries.some(([entryKey]) => entryKey === key)
    if (!shouldExist) {
      controlDb.execute('DELETE FROM AppSetting WHERE key = ?', key)
    }
  }

  for (const [key, value] of nextEntries) {
    controlDb.execute(
      `
        INSERT INTO AppSetting (id, key, value)
        VALUES (lower(hex(randomblob(16))), ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updatedAt = CURRENT_TIMESTAMP
      `,
      key,
      value
    )
  }
}

function assertProtectedAppSettingsRestored(controlDb: DatabaseAccess, snapshot: ProtectedAppSettingsResetSnapshot) {
  const restored = readProtectedAppSettingsResetSnapshot(controlDb)
  validateProtectedAppSettingsResetSnapshot(restored)

  if (
    restored.presetCompatLibraryV1 !== snapshot.presetCompatLibraryV1
    || restored.aiSettingsV2 !== snapshot.aiSettingsV2
    || restored.ollamaTimeoutMs !== snapshot.ollamaTimeoutMs
  ) {
    throw new Error('Protected reset restore validation failed')
  }
}

export async function resetBusinessDataPreservingProtectedSettings() {
  const controlDb = createControlDatabaseAccess()
  const controlMutation = await controlDb.withTransaction(() => {
    const fullSnapshot = controlDb.queryAll<AppSettingRow>(
      'SELECT id, key, value, createdAt, updatedAt FROM AppSetting ORDER BY rowid ASC',
    )
    const snapshot = readProtectedAppSettingsResetSnapshot(controlDb)
    validateProtectedAppSettingsResetSnapshot(snapshot)
    clearNonProtectedAppSettings(controlDb)
    restoreProtectedAppSettings(controlDb, snapshot)
    assertProtectedAppSettingsRestored(controlDb, snapshot)
    return { snapshot, fullSnapshot }
  })

  try {
    await withTransaction(async () => {
      clearBusinessDataTables()
    })
  } catch (originalFailure) {
    try {
      await controlDb.withTransaction(() => {
        controlDb.execute('DELETE FROM AppSetting')
        for (const row of controlMutation.fullSnapshot) {
          controlDb.execute(
            `INSERT INTO AppSetting (id, key, value, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?)`,
            row.id,
            row.key,
            row.value,
            row.createdAt,
            row.updatedAt,
          )
        }
      })
    } catch (compensationFailure) {
      throw new AggregateError(
        [originalFailure, compensationFailure],
        'Novel business reset failed and control settings compensation also failed',
      )
    }
    throw originalFailure
  }
  return controlMutation.snapshot
}
