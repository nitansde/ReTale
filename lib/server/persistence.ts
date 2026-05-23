import { PROTECTED_RESET_APP_SETTING_KEYS } from '@/lib/server/schema'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/sqlite'

type WorkspaceStateRow = {
  id: string
  payload: string
  createdAt: string
  updatedAt: string
}

type WorkspaceStateBackupRow = {
  id: string
  workspaceStateId: string
  payload: string
  reason: string
  sourceUpdatedAt: string | null
  createdAt: string
}

type WorkspaceStateWriteOptions = {
  backupReason?: string
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

export type ProtectedAppSettingsResetSnapshot = {
  presetCompatLibraryV1: string | null
  aiSettingsV2: string | null
  ollamaTimeoutMs: string | null
}

export function findWorkspaceState(id = 'singleton') {
  return queryOne<WorkspaceStateRow>('SELECT id, payload, createdAt, updatedAt FROM WorkspaceState WHERE id = ?', id)
}

export function findWorkspaceStateBackups(id = 'singleton') {
  return queryAll<WorkspaceStateBackupRow>(
    `SELECT id, workspaceStateId, payload, reason, sourceUpdatedAt, createdAt
     FROM WorkspaceStateBackup
     WHERE workspaceStateId = ?
     ORDER BY createdAt DESC, rowid DESC`,
    id
  )
}

export function createWorkspaceState(id: string, payload: string) {
  execute('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)', id, payload)
  const created = findWorkspaceState(id)
  if (!created) {
    throw new Error('Failed to create workspace state')
  }
  return created
}

function createWorkspaceStateBackup(row: WorkspaceStateRow, reason: string) {
  execute(
    `INSERT INTO WorkspaceStateBackup (id, workspaceStateId, payload, reason, sourceUpdatedAt)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
    row.id,
    row.payload,
    reason,
    row.updatedAt
  )
}

function pruneWorkspaceStateBackups(id: string) {
  execute(
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
  execute('BEGIN IMMEDIATE')
  try {
    const existing = findWorkspaceState(id)
    if (existing && existing.payload !== payload) {
      createWorkspaceStateBackup(existing, options.backupReason ?? 'overwrite')
    }

    execute(
      `
        INSERT INTO WorkspaceState (id, payload)
        VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload,
          updatedAt = CURRENT_TIMESTAMP
      `,
      id,
      payload
    )

    pruneWorkspaceStateBackups(id)
    execute('COMMIT')
  } catch (error) {
    try {
      execute('ROLLBACK')
    } catch {
    }
    throw error
  }

  const saved = findWorkspaceState(id)
  if (!saved) {
    throw new Error('Failed to save workspace state')
  }
  return saved
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
  if (value === null || !value.trim()) {
    return null
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
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
