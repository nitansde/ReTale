import { safeParseJson } from '@/lib/server/json-parse'
import { PROTECTED_RESET_APP_SETTING_KEYS } from '@/lib/server/schema'
import {
  createDatabaseAccess,
  createNovelDatabaseAccess,
  execute,
  queryAll,
  type DatabaseAccess,
  withTransaction,
} from '@/lib/server/database-access'
import { getControlDb, getNovelDb, getNovelLanceDbPath } from '@/lib/server/db-resolver'
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

type SqliteTableRow = {
  name: string
}

const [PRESET_COMPAT_LIBRARY_V1_KEY, AI_SETTINGS_V2_KEY, OLLAMA_TIMEOUT_MS_KEY] = PROTECTED_RESET_APP_SETTING_KEYS
const WORKSPACE_BACKUP_RETENTION = 20
const WORKSPACE_KNOWLEDGE_SYNC_STALE_MS = 5 * 60 * 1000
const ACTIVE_WORKSPACE_NOVEL_ID_KEY = 'WORKSPACE_ACTIVE_NOVEL_ID'

export type ProtectedAppSettingsResetSnapshot = {
  presetCompatLibraryV1: string | null
  aiSettingsV2: string | null
  ollamaTimeoutMs: string | null
}

function getControlDatabaseAccess() {
  return createDatabaseAccess(getControlDb())
}

function getNovelDatabaseAccess(novelId: string) {
  return createNovelDatabaseAccess(novelId)
}

function getNovelDbFilePath(novelId: string) {
  return (getNovelDb(novelId).prepare('PRAGMA database_list').get() as { file: string }).file
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
  return getControlDatabaseAccess().queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', ACTIVE_WORKSPACE_NOVEL_ID_KEY)?.value ?? null
}

export function writeActiveWorkspaceNovelId(novelId: string) {
  getControlDatabaseAccess().execute(
    `INSERT INTO AppSetting (id, key, value)
     VALUES (lower(hex(randomblob(16))), ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updatedAt = CURRENT_TIMESTAMP`,
    ACTIVE_WORKSPACE_NOVEL_ID_KEY,
    novelId,
  )
}

export function upsertWorkspaceNovelRegistry(params: { novelId: string; title?: string | null }) {
  const controlDb = getControlDatabaseAccess()
  controlDb.execute(
    `INSERT INTO NovelRegistry (
       novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
     ) VALUES (?, ?, ?, ?, ?, '1', 'ready')
     ON CONFLICT(novelId) DO UPDATE SET
       title = COALESCE(excluded.title, NovelRegistry.title),
       dbFilePath = excluded.dbFilePath,
       lanceDbPath = excluded.lanceDbPath,
       schemaVersion = excluded.schemaVersion,
       migrationStatus = excluded.migrationStatus,
       updatedAt = CURRENT_TIMESTAMP`,
    params.novelId,
    params.novelId,
    params.title?.trim() || null,
    getNovelDbFilePath(params.novelId),
    getNovelLanceDbPath(params.novelId),
  )
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
  const placeholders = keys.map(() => '?').join(', ')
  return queryAll<AppSettingRow>(
    `SELECT id, key, value, createdAt, updatedAt FROM AppSetting WHERE key IN (${placeholders})`,
    ...keys
  )
}

export async function upsertAppSettings(entries: ReadonlyArray<readonly [string, string]>) {
  await withTransaction(async () => {
    for (const [key, value] of entries) {
      execute(
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

function readProtectedAppSettingsResetSnapshot(): ProtectedAppSettingsResetSnapshot {
  const entries = findAppSettings(PROTECTED_RESET_APP_SETTING_KEYS)
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

function clearNonProtectedAppSettings() {
  const placeholders = PROTECTED_RESET_APP_SETTING_KEYS.map(() => '?').join(', ')
  execute(
    `DELETE FROM AppSetting WHERE key NOT IN (${placeholders})`,
    ...PROTECTED_RESET_APP_SETTING_KEYS
  )
}

function restoreProtectedAppSettings(snapshot: ProtectedAppSettingsResetSnapshot) {
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
      execute('DELETE FROM AppSetting WHERE key = ?', key)
    }
  }

  for (const [key, value] of nextEntries) {
    execute(
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

function assertProtectedAppSettingsRestored(snapshot: ProtectedAppSettingsResetSnapshot) {
  const restored = readProtectedAppSettingsResetSnapshot()
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
  return withTransaction(async () => {
    const snapshot = readProtectedAppSettingsResetSnapshot()
    validateProtectedAppSettingsResetSnapshot(snapshot)
    clearBusinessDataTables()
    clearNonProtectedAppSettings()
    restoreProtectedAppSettings(snapshot)
    assertProtectedAppSettingsRestored(snapshot)
    return snapshot
  })
}
