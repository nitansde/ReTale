import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/sqlite'

type WorkspaceStateRow = {
  id: string
  payload: string
  createdAt: string
  updatedAt: string
}

type AppSettingRow = {
  id: string
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

export function findWorkspaceState(id = 'singleton') {
  return queryOne<WorkspaceStateRow>('SELECT id, payload, createdAt, updatedAt FROM WorkspaceState WHERE id = ?', id)
}

export function createWorkspaceState(id: string, payload: string) {
  execute('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)', id, payload)
  const created = findWorkspaceState(id)
  if (!created) {
    throw new Error('Failed to create workspace state')
  }
  return created
}

export function upsertWorkspaceState(id: string, payload: string) {
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
