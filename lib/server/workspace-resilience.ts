import { findWorkspaceState, upsertWorkspaceState } from '@/lib/server/persistence'
import { queryAll, queryOne } from '@/lib/server/sqlite'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'
import { countChineseFriendlyWords, plainTextLinesToHtml } from '@/lib/utils'
import type { Chapter, LocalNovelMeta, PersistedNovelState, Volume } from '@/lib/types'

const WORKSPACE_ID = 'singleton'
const WORKSPACE_BACKUP_RETENTION = 20
export const WORKSPACE_RESET_HEADER = 'x-chatbook-workspace-reset'

type SqlParam = string | number | bigint | Uint8Array | null

type WorkspaceRecoveryDb = {
  execute: (sql: string, ...params: SqlParam[]) => unknown
  queryAll: <T>(sql: string, ...params: SqlParam[]) => T[]
  queryOne: <T>(sql: string, ...params: SqlParam[]) => T | null
}

type CountRow = {
  count: number
}

type NovelRow = {
  id: string
  title: string
  updatedAt: string
}

type KnowledgeChapterRow = {
  id: string
  novelId: string
  chapterNo: number
  title: string | null
  rawText: string
  updatedAt: string
}

type WorkspaceStateRow = {
  id: string
  payload: string
  createdAt: string
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function workspacePayloadHasLibraryContent(payload: unknown) {
  if (!isRecord(payload)) return false
  return (Array.isArray(payload.localNovels) && payload.localNovels.length > 0)
    || (Array.isArray(payload.localChapters) && payload.localChapters.length > 0)
}

function safeParseWorkspacePayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as Partial<PersistedNovelState>
    const normalized = normalizeWorkspaceState(parsed)
    return { ok: true as const, payload: normalized }
  } catch (error) {
    return { ok: false as const, error }
  }
}

function queryOneFromDb<T>(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  return db ? db.queryOne<T>(sql, ...params) : queryOne<T>(sql, ...params)
}

function queryAllFromDb<T>(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  return db ? db.queryAll<T>(sql, ...params) : queryAll<T>(sql, ...params)
}

function findWorkspaceStateForRecovery(id: string, db?: WorkspaceRecoveryDb) {
  return db
    ? db.queryOne<WorkspaceStateRow>('SELECT id, payload, createdAt, updatedAt FROM WorkspaceState WHERE id = ?', id)
    : findWorkspaceState(id)
}

function upsertWorkspaceStateForRecovery(id: string, payload: string, backupReason: string, db?: WorkspaceRecoveryDb) {
  if (!db) {
    return upsertWorkspaceState(id, payload, { backupReason })
  }

  db.execute('BEGIN IMMEDIATE')
  try {
    const existing = findWorkspaceStateForRecovery(id, db)
    if (existing && existing.payload !== payload) {
      db.execute(
        `INSERT INTO WorkspaceStateBackup (id, workspaceStateId, payload, reason, sourceUpdatedAt)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
        existing.id,
        existing.payload,
        backupReason,
        existing.updatedAt
      )
    }

    db.execute(
      `INSERT INTO WorkspaceState (id, payload)
       VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload = excluded.payload,
         updatedAt = CURRENT_TIMESTAMP`,
      id,
      payload
    )

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
    db.execute('COMMIT')
  } catch (error) {
    try {
      db.execute('ROLLBACK')
    } catch {
    }
    throw error
  }

  const saved = findWorkspaceStateForRecovery(id, db)
  if (!saved) {
    throw new Error('Failed to save workspace state')
  }
  return saved
}

export function hasRecoverableKnowledgeWorkspaceSource(db?: WorkspaceRecoveryDb) {
  const novelCount = queryOneFromDb<CountRow>(db, 'SELECT COUNT(*) AS count FROM NovelRecord')?.count ?? 0
  const chapterCount = queryOneFromDb<CountRow>(db, 'SELECT COUNT(*) AS count FROM KnowledgeChapter')?.count ?? 0
  return novelCount > 0 && chapterCount > 0
}

function readRecoverableKnowledgeChapters(db?: WorkspaceRecoveryDb) {
  const mainBranchRows = queryAllFromDb<KnowledgeChapterRow>(
    db,
    `SELECT KnowledgeChapter.id, KnowledgeChapter.novelId, KnowledgeChapter.chapterNo,
            KnowledgeChapter.title, KnowledgeChapter.rawText, KnowledgeChapter.updatedAt
     FROM KnowledgeChapter
     INNER JOIN StoryBranch ON StoryBranch.id = KnowledgeChapter.branchId
     WHERE StoryBranch.name = 'main'
     ORDER BY KnowledgeChapter.novelId ASC, KnowledgeChapter.chapterNo ASC, KnowledgeChapter.id ASC`
  )

  if (mainBranchRows.length) return mainBranchRows

  return queryAllFromDb<KnowledgeChapterRow>(
    db,
    `SELECT id, novelId, chapterNo, title, rawText, updatedAt
     FROM KnowledgeChapter
     ORDER BY novelId ASC, chapterNo ASC, id ASC`
  )
}

export function recoverWorkspaceStateFromKnowledgeStore(db?: WorkspaceRecoveryDb) {
  const novels = queryAllFromDb<NovelRow>(db, 'SELECT id, title, updatedAt FROM NovelRecord ORDER BY updatedAt DESC, id ASC')
  const chapters = readRecoverableKnowledgeChapters(db)
  if (!novels.length || !chapters.length) return null

  const chapterCountByNovel = chapters.reduce((counts, chapter) => {
    counts.set(chapter.novelId, (counts.get(chapter.novelId) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  const localNovels: LocalNovelMeta[] = novels.map((novel) => ({
    id: novel.id,
    title: novel.title,
    summary: `从知识库自动修复，共 ${chapterCountByNovel.get(novel.id) ?? 0} 章。`,
    tags: ['恢复', '知识库'],
  }))

  const localVolumes: Volume[] = novels.map((novel) => ({
    id: `vol_${novel.id}`,
    novelId: novel.id,
    title: '卷一：恢复正文',
    order: 1,
  }))
  const volumeIdByNovel = new Map(localVolumes.map((volume) => [volume.novelId, volume.id]))

  const localChapters: Chapter[] = chapters.map((chapter) => {
    const contentText = chapter.rawText.trim() || '（本章暂无正文）'
    const content = plainTextLinesToHtml(contentText)
    return {
      id: chapter.id,
      novelId: chapter.novelId,
      volumeId: volumeIdByNovel.get(chapter.novelId) ?? `vol_${chapter.novelId}`,
      title: chapter.title?.trim() || `第${chapter.chapterNo}章`,
      order: chapter.chapterNo,
      content,
      originalContent: content,
      status: 'draft',
      wordCount: countChineseFriendlyWords(contentText),
      updatedAt: chapter.updatedAt,
    }
  })

  const firstChapter = localChapters[0]
  return normalizeWorkspaceState({
    ...createEmptyWorkspaceState(),
    currentNovelId: firstChapter?.novelId ?? '',
    currentChapterId: firstChapter?.id ?? '',
    localNovels,
    localVolumes,
    localChapters,
    expandedVolumeIds: localVolumes.map((volume) => volume.id),
    trajectories: firstChapter
      ? [{
        id: `traj_workspace_recovery_${Date.now()}`,
        chapterId: firstChapter.id,
        type: 'note',
        title: '自动修复工作区',
        detail: `从知识库恢复 ${localNovels.length} 本书、${localChapters.length} 章。`,
        createdAt: '刚刚 · 自动修复',
      }]
      : [],
  })
}

export function loadWorkspacePayloadWithRecovery(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const existing = findWorkspaceStateForRecovery(id, db)
  if (!existing) {
    const recovered = recoverWorkspaceStateFromKnowledgeStore(db)
    if (!recovered) return createEmptyWorkspaceState()
    upsertWorkspaceStateForRecovery(id, JSON.stringify(recovered), 'recover-missing', db)
    return recovered
  }

  const parsed = safeParseWorkspacePayload(existing.payload)
  if (parsed.ok && workspacePayloadHasLibraryContent(parsed.payload)) {
    return parsed.payload
  }

  const recovered = recoverWorkspaceStateFromKnowledgeStore(db)
  if (recovered) {
    upsertWorkspaceStateForRecovery(id, JSON.stringify(recovered), parsed.ok ? 'recover-empty' : 'recover-corrupt', db)
    return recovered
  }

  if (parsed.ok) return parsed.payload
  throw new Error('Saved workspace payload is invalid and no recoverable knowledge data exists')
}

export function isExplicitWorkspaceResetRequest(request: Request) {
  return request.headers.get(WORKSPACE_RESET_HEADER) === 'true'
}

export function shouldBlockEmptyWorkspaceOverwrite(payload: unknown, allowReset: boolean, id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  if (allowReset || workspacePayloadHasLibraryContent(payload)) return false

  const existing = findWorkspaceStateForRecovery(id, db)
  if (existing) {
    const parsed = safeParseWorkspacePayload(existing.payload)
    if (parsed.ok && workspacePayloadHasLibraryContent(parsed.payload)) return true
  }

  return hasRecoverableKnowledgeWorkspaceSource(db)
}
