import { findWorkspaceState } from '@/lib/server/persistence'
import { safeParseJson as safeParseJsonValue, safeParseJsonObject } from '@/lib/server/json-parse'
import { execute, queryAll, queryOne } from '@/lib/server/sqlite'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'
import { countChineseFriendlyWords, plainTextLinesToHtml } from '@/lib/utils'
import type {
  Chapter,
  Character,
  CharacterRelation,
  LocalNovelMeta,
  OutlineItem,
  PersistedNovelState,
  TimelineEvent,
  Volume,
  WorldEntry,
} from '@/lib/types'

const WORKSPACE_ID = 'singleton'
export const WORKSPACE_RESET_HEADER = 'x-chatbook-workspace-reset'

type SqlParam = string | number | bigint | Uint8Array | null

type WorkspaceRecoveryDb = {
  execute: (sql: string, ...params: SqlParam[]) => unknown
  queryAll: <T>(sql: string, ...params: SqlParam[]) => T[]
  queryOne: <T>(sql: string, ...params: SqlParam[]) => T | null
}

type WorkspaceRuntimeStateRow = {
  id: string
  currentNovelId: string
  currentChapterId: string
  currentTab: string
  helperTab: string
  expandedVolumeIdsJson: string
  localOutlinesJson: string
  localCharactersJson: string
  localCharacterRelationsJson: string
  localWorldEntriesJson: string
  localTimelineEventsJson: string
  rewriteCandidatesJson: string
  rewriteHistoryJson: string
  trajectoriesJson: string
  rewriteMode: string
  rewriteTone: string
  rewriteOutput: string
  rewriteScope: string
  selectionText: string
  selectedParagraphIndex: number
  thinkingLevel: string
  autoContinue: number
  keepCanon: number
  promptText: string
  selectedPresetId: string
  presetsJson: string
  constraintsJson: string
  focusMode: number
  presetCompatSessionStateJson: string
  updatedAt: string
}

type WorkspaceRuntimeNovelRow = {
  id: string
  title: string
  summary: string
  tagsJson: string
  sortOrder: number
}

type WorkspaceRuntimeVolumeRow = {
  id: string
  novelId: string
  title: string
  sortOrder: number
}

type WorkspaceRuntimeChapterRow = {
  id: string
  novelId: string
  volumeId: string
  parentChapterId: string | null
  kind: string | null
  branchLabel: string | null
  title: string
  sortOrder: number
  contentHtml: string
  originalContentHtml: string | null
  status: string
  wordCount: number
  updatedAtLabel: string
  trajectoryJson: string
}

type WorkspaceRuntimeSaveResult = {
  updatedAt: string
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
  payload: string | null
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

function safeParseJson(value: string | null) {
  return safeParseJsonValue(value)
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readJsonArray(value: string | null) {
  const parsed = safeParseJson(value)
  return Array.isArray(parsed) ? parsed : []
}

function readJsonObject(value: string | null) {
  return safeParseJsonObject(value) ?? {}
}

function queryOneFromDb<T>(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  return db ? db.queryOne<T>(sql, ...params) : queryOne<T>(sql, ...params)
}

function queryAllFromDb<T>(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  return db ? db.queryAll<T>(sql, ...params) : queryAll<T>(sql, ...params)
}

function executeOnDb(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  return db ? db.execute(sql, ...params) : execute(sql, ...params)
}

function findWorkspaceStateForRecovery(id: string, db?: WorkspaceRecoveryDb) {
  return db
    ? db.queryOne<WorkspaceStateRow>('SELECT id, payload, createdAt, updatedAt FROM WorkspaceState WHERE id = ?', id)
    : findWorkspaceState(id)
}

function readWorkspaceRuntimeState(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const meta = queryOneFromDb<WorkspaceRuntimeStateRow>(
    db,
    `SELECT id, currentNovelId, currentChapterId, currentTab, helperTab,
            expandedVolumeIdsJson, localOutlinesJson, localCharactersJson, localCharacterRelationsJson,
            localWorldEntriesJson, localTimelineEventsJson, rewriteCandidatesJson, rewriteHistoryJson, trajectoriesJson,
            rewriteMode, rewriteTone, rewriteOutput, rewriteScope, selectionText,
            selectedParagraphIndex, thinkingLevel, autoContinue, keepCanon, promptText,
            selectedPresetId, presetsJson, constraintsJson, focusMode, presetCompatSessionStateJson,
            updatedAt
     FROM WorkspaceRuntimeState
     WHERE id = ?`,
    id,
  )
  const novels = queryAllFromDb<WorkspaceRuntimeNovelRow>(
    db,
    `SELECT id, title, summary, tagsJson, sortOrder
     FROM WorkspaceRuntimeNovel
     WHERE workspaceStateId = ?
     ORDER BY sortOrder ASC, id ASC`,
    id,
  )
  const volumes = queryAllFromDb<WorkspaceRuntimeVolumeRow>(
    db,
    `SELECT id, novelId, title, sortOrder
     FROM WorkspaceRuntimeVolume
     WHERE workspaceStateId = ?
     ORDER BY novelId ASC, sortOrder ASC, id ASC`,
    id,
  )
  const chapters = queryAllFromDb<WorkspaceRuntimeChapterRow>(
    db,
    `SELECT id, novelId, volumeId, parentChapterId, kind, branchLabel, title, sortOrder,
            contentHtml, originalContentHtml, status, wordCount, updatedAtLabel, trajectoryJson
     FROM WorkspaceRuntimeChapter
     WHERE workspaceStateId = ?
     ORDER BY novelId ASC, sortOrder ASC, id ASC`,
    id,
  )

  if (!meta && !novels.length && !volumes.length && !chapters.length) {
    return null
  }

  return normalizeWorkspaceState({
    ...createEmptyWorkspaceState(),
    currentNovelId: meta?.currentNovelId ?? '',
    currentChapterId: meta?.currentChapterId ?? '',
    currentTab: meta?.currentTab as PersistedNovelState['currentTab'] | undefined,
    helperTab: meta?.helperTab as PersistedNovelState['helperTab'] | undefined,
    expandedVolumeIds: normalizeStringArray(readJsonArray(meta?.expandedVolumeIdsJson ?? '[]')),
    localOutlines: readJsonArray(meta?.localOutlinesJson ?? '[]') as OutlineItem[],
    localCharacters: readJsonArray(meta?.localCharactersJson ?? '[]') as Character[],
    localCharacterRelations: readJsonArray(meta?.localCharacterRelationsJson ?? '[]') as CharacterRelation[],
    localWorldEntries: readJsonArray(meta?.localWorldEntriesJson ?? '[]') as WorldEntry[],
    localTimelineEvents: readJsonArray(meta?.localTimelineEventsJson ?? '[]') as TimelineEvent[],
    localNovels: novels.map((novel) => ({
      id: novel.id,
      title: novel.title,
      summary: novel.summary,
      tags: normalizeStringArray(readJsonArray(novel.tagsJson)),
    })),
    localVolumes: volumes.map((volume) => ({
      id: volume.id,
      novelId: volume.novelId,
      title: volume.title,
      order: volume.sortOrder,
    })),
    localChapters: chapters.map((chapter) => ({
      id: chapter.id,
      novelId: chapter.novelId,
      volumeId: chapter.volumeId,
      parentChapterId: chapter.parentChapterId ?? undefined,
      kind: chapter.kind as Chapter['kind'] | undefined,
      branchLabel: chapter.branchLabel ?? undefined,
      title: chapter.title,
      order: chapter.sortOrder,
      content: chapter.contentHtml,
      originalContent: chapter.originalContentHtml ?? undefined,
      status: chapter.status as Chapter['status'],
      wordCount: chapter.wordCount,
      updatedAt: chapter.updatedAtLabel,
      trajectory: normalizeStringArray(readJsonArray(chapter.trajectoryJson)),
    })),
    rewriteCandidates: readJsonArray(meta?.rewriteCandidatesJson ?? '[]'),
    rewriteHistory: readJsonArray(meta?.rewriteHistoryJson ?? '[]'),
    trajectories: readJsonArray(meta?.trajectoriesJson ?? '[]'),
    rewriteMode: meta?.rewriteMode as PersistedNovelState['rewriteMode'] | undefined,
    rewriteTone: meta?.rewriteTone as PersistedNovelState['rewriteTone'] | undefined,
    rewriteOutput: meta?.rewriteOutput as PersistedNovelState['rewriteOutput'] | undefined,
    rewriteScope: meta?.rewriteScope as PersistedNovelState['rewriteScope'] | undefined,
    selectionText: meta?.selectionText,
    selectedParagraphIndex: meta?.selectedParagraphIndex,
    thinkingLevel: meta?.thinkingLevel as PersistedNovelState['thinkingLevel'] | undefined,
    autoContinue: Boolean(meta?.autoContinue ?? 1),
    keepCanon: Boolean(meta?.keepCanon ?? 1),
    promptText: meta?.promptText,
    selectedPresetId: meta?.selectedPresetId,
    presets: readJsonArray(meta?.presetsJson ?? '[]'),
    constraints: readJsonArray(meta?.constraintsJson ?? '[]'),
    focusMode: Boolean(meta?.focusMode ?? 0),
    presetCompatSessionState: readJsonObject(meta?.presetCompatSessionStateJson ?? '{}') as PersistedNovelState['presetCompatSessionState'],
  })
}

export function loadWorkspaceKnowledgeSyncPayload(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const payload = readWorkspaceRuntimeState(id, db)
  if (!payload) return null
  return {
    localNovels: payload.localNovels,
    localChapters: payload.localChapters,
    localOutlines: payload.localOutlines,
    localTimelineEvents: payload.localTimelineEvents,
    currentNovelId: payload.currentNovelId,
  }
}

export function persistWorkspaceRuntimeState(
  payload: PersistedNovelState,
  id = WORKSPACE_ID,
  db?: WorkspaceRecoveryDb,
): WorkspaceRuntimeSaveResult {
  const normalized = normalizeWorkspaceState(payload)
  executeOnDb(db, 'BEGIN IMMEDIATE')
  try {
    executeOnDb(
      db,
       `INSERT INTO WorkspaceRuntimeState (
          id, currentNovelId, currentChapterId, currentTab, helperTab,
         expandedVolumeIdsJson, localOutlinesJson, localCharactersJson, localCharacterRelationsJson,
         localWorldEntriesJson, localTimelineEventsJson, rewriteCandidatesJson, rewriteHistoryJson, trajectoriesJson,
         rewriteMode, rewriteTone, rewriteOutput, rewriteScope, selectionText,
         selectedParagraphIndex, thinkingLevel, autoContinue, keepCanon, promptText,
         selectedPresetId, presetsJson, constraintsJson, focusMode, presetCompatSessionStateJson
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         currentNovelId = excluded.currentNovelId,
         currentChapterId = excluded.currentChapterId,
         currentTab = excluded.currentTab,
         helperTab = excluded.helperTab,
         expandedVolumeIdsJson = excluded.expandedVolumeIdsJson,
         localOutlinesJson = excluded.localOutlinesJson,
         localCharactersJson = excluded.localCharactersJson,
         localCharacterRelationsJson = excluded.localCharacterRelationsJson,
         localWorldEntriesJson = excluded.localWorldEntriesJson,
         localTimelineEventsJson = excluded.localTimelineEventsJson,
         rewriteCandidatesJson = excluded.rewriteCandidatesJson,
         rewriteHistoryJson = excluded.rewriteHistoryJson,
         trajectoriesJson = excluded.trajectoriesJson,
         rewriteMode = excluded.rewriteMode,
         rewriteTone = excluded.rewriteTone,
         rewriteOutput = excluded.rewriteOutput,
         rewriteScope = excluded.rewriteScope,
         selectionText = excluded.selectionText,
         selectedParagraphIndex = excluded.selectedParagraphIndex,
         thinkingLevel = excluded.thinkingLevel,
         autoContinue = excluded.autoContinue,
         keepCanon = excluded.keepCanon,
         promptText = excluded.promptText,
         selectedPresetId = excluded.selectedPresetId,
         presetsJson = excluded.presetsJson,
         constraintsJson = excluded.constraintsJson,
         focusMode = excluded.focusMode,
         presetCompatSessionStateJson = excluded.presetCompatSessionStateJson,
         updatedAt = CURRENT_TIMESTAMP`,
      id,
      normalized.currentNovelId,
      normalized.currentChapterId,
      normalized.currentTab,
      normalized.helperTab,
      JSON.stringify(normalized.expandedVolumeIds),
      JSON.stringify(normalized.localOutlines),
      JSON.stringify(normalized.localCharacters),
      JSON.stringify(normalized.localCharacterRelations),
      JSON.stringify(normalized.localWorldEntries),
      JSON.stringify(normalized.localTimelineEvents),
      JSON.stringify(normalized.rewriteCandidates),
      JSON.stringify(normalized.rewriteHistory),
      JSON.stringify(normalized.trajectories),
      normalized.rewriteMode,
      normalized.rewriteTone,
      normalized.rewriteOutput,
      normalized.rewriteScope,
      normalized.selectionText,
      normalized.selectedParagraphIndex,
      normalized.thinkingLevel,
      normalized.autoContinue ? 1 : 0,
      normalized.keepCanon ? 1 : 0,
      normalized.promptText,
      normalized.selectedPresetId,
      JSON.stringify(normalized.presets),
      JSON.stringify(normalized.constraints),
      normalized.focusMode ? 1 : 0,
      JSON.stringify(normalized.presetCompatSessionState),
    )

    executeOnDb(db, 'DELETE FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ?', id)
    executeOnDb(db, 'DELETE FROM WorkspaceRuntimeVolume WHERE workspaceStateId = ?', id)
    executeOnDb(db, 'DELETE FROM WorkspaceRuntimeNovel WHERE workspaceStateId = ?', id)

    normalized.localNovels.forEach((novel, index) => {
      executeOnDb(
        db,
        `INSERT INTO WorkspaceRuntimeNovel (workspaceStateId, id, title, summary, tagsJson, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        novel.id,
        novel.title,
        novel.summary,
        JSON.stringify(novel.tags ?? []),
        index,
      )
    })

    normalized.localVolumes.forEach((volume, index) => {
      executeOnDb(
        db,
        `INSERT INTO WorkspaceRuntimeVolume (workspaceStateId, id, novelId, title, sortOrder)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        volume.id,
        volume.novelId,
        volume.title,
        Number.isFinite(volume.order) ? volume.order : index + 1,
      )
    })

    normalized.localChapters.forEach((chapter, index) => {
      executeOnDb(
        db,
        `INSERT INTO WorkspaceRuntimeChapter (
           workspaceStateId, id, novelId, volumeId, parentChapterId, kind, branchLabel, title,
           sortOrder, contentHtml, originalContentHtml, status, wordCount, updatedAtLabel, trajectoryJson
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        chapter.id,
        chapter.novelId,
        chapter.volumeId,
        chapter.parentChapterId ?? null,
        chapter.kind ?? null,
        chapter.branchLabel ?? null,
        chapter.title,
        Number.isFinite(chapter.order) ? chapter.order : index + 1,
        chapter.content,
        chapter.originalContent ?? null,
        chapter.status,
        chapter.wordCount,
        chapter.updatedAt,
        JSON.stringify(chapter.trajectory ?? []),
      )
    })

    executeOnDb(db, 'COMMIT')
  } catch (error) {
    try {
      executeOnDb(db, 'ROLLBACK')
    } catch {
    }
    throw error
  }

  const saved = queryOneFromDb<{ updatedAt: string }>(db, 'SELECT updatedAt FROM WorkspaceRuntimeState WHERE id = ?', id)
  if (!saved) {
    throw new Error('Failed to save workspace runtime state')
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

function readWorkspaceArtifactPayload(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const existing = findWorkspaceStateForRecovery(id, db)
  if (!existing?.payload?.trim()) {
    return { ok: false as const, reason: 'missing' as const }
  }

  const parsed = safeParseWorkspacePayload(existing.payload)
  if (!parsed.ok) {
    return { ok: false as const, reason: 'invalid' as const, error: parsed.error }
  }

  return { ok: true as const, payload: parsed.payload }
}

export function backfillWorkspaceRuntimeFromArtifactIfMissing(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const runtimeState = readWorkspaceRuntimeState(id, db)
  if (runtimeState) return runtimeState

  const artifact = readWorkspaceArtifactPayload(id, db)
  if (!artifact.ok) {
    if (artifact.reason === 'invalid') {
      throw new Error('Saved workspace payload artifact is invalid and cannot backfill runtime state')
    }
    return null
  }

  persistWorkspaceRuntimeState(artifact.payload, id, db)
  return artifact.payload
}

export function loadWorkspacePayloadFromRuntimeOrRecovery(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const runtimeState = readWorkspaceRuntimeState(id, db)
  if (runtimeState) {
    return runtimeState
  }

  const recovered = recoverWorkspaceStateFromKnowledgeStore(db)
  if (recovered) {
    persistWorkspaceRuntimeState(recovered, id, db)
    return recovered
  }

  return createEmptyWorkspaceState()
}

export function isExplicitWorkspaceResetRequest(request: Request) {
  return request.headers.get(WORKSPACE_RESET_HEADER) === 'true'
}

export function shouldBlockEmptyWorkspaceOverwrite(payload: unknown, allowReset: boolean, id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  if (allowReset || workspacePayloadHasLibraryContent(payload)) return false

  const existingRuntime = readWorkspaceRuntimeState(id, db)
  if (existingRuntime && workspacePayloadHasLibraryContent(existingRuntime)) {
    return true
  }

  const artifact = readWorkspaceArtifactPayload(id, db)
  if (artifact.ok && workspacePayloadHasLibraryContent(artifact.payload)) {
    return true
  }

  return hasRecoverableKnowledgeWorkspaceSource(db)
}
