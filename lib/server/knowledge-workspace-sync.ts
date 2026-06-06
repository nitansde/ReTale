import type { Chapter, PersistedNovelState } from '@/lib/types'
import { bootstrapOutlineNodesForFutureMap } from '@/lib/server/outline-bootstrap'
import {
  ensureKnowledgeChapterDerivedArtifacts,
  getMainBranchId,
  hashContent,
  markKnowledgeStaleFromChapter,
  replaceKnowledgeChapterDerivedArtifacts,
} from '@/lib/server/knowledge-store'
import { deleteBranchRetrievalIndex } from '@/lib/server/retrieval-index'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/sqlite'
import { htmlToPlainText } from '@/lib/utils'

type KnowledgeChapterRow = {
  id: string
  novelId: string
  branchId: string
  chapterNo: number
  title: string | null
  rawText: string
  revision: number
  sourceHash: string
}

export type WorkspaceKnowledgeSyncPayload = {
  localNovels?: Array<{ id: string; title: string; summary: string; tags: string[] }>
  localChapters?: Chapter[]
  localOutlines?: PersistedNovelState['localOutlines']
  localTimelineEvents?: PersistedNovelState['localTimelineEvents']
  currentNovelId?: string
}

type WorkspaceKnowledgeSyncDependencies = {
  abortKnowledgeRebuildUntilIdle: (params: { novelId: string; branchId: string }) => Promise<void>
}

function upsertNovelRecord(params: { novelId: string; title: string }) {
  execute(
    `
      INSERT INTO NovelRecord (id, title, sourceType)
      VALUES (?, ?, 'workspace')
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        sourceType = excluded.sourceType,
        updatedAt = CURRENT_TIMESTAMP
    `,
    params.novelId,
    params.title,
  )
}

function upsertStoryBranch(novelId: string, branchId: string, name: string) {
  execute(
    `
      INSERT INTO StoryBranch (id, novelId, name)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        novelId = excluded.novelId,
        name = excluded.name,
        updatedAt = CURRENT_TIMESTAMP
    `,
    branchId,
    novelId,
    name,
  )
}

async function deleteNovelProjectionArtifacts(novelId: string, branchId: string) {
  await withTransaction(async () => {
    execute(
      `
        DELETE FROM future_jump_revisions
        WHERE run_id IN (
          SELECT id FROM future_jump_runs
          WHERE base_branch_id = ?
             OR session_id IN (SELECT id FROM what_if_sessions WHERE novel_id = ?)
        )
      `,
      branchId,
      novelId,
    )
    execute(
      `
        DELETE FROM future_jump_runs
        WHERE base_branch_id = ?
           OR session_id IN (SELECT id FROM what_if_sessions WHERE novel_id = ?)
      `,
      branchId,
      novelId,
    )
    execute('DELETE FROM story_timeline_nodes WHERE novel_id = ?', novelId)
    execute('DELETE FROM what_if_sessions WHERE novel_id = ?', novelId)
    execute('DELETE FROM outline_node_chapters WHERE outline_node_id IN (SELECT id FROM outline_nodes WHERE novel_id = ?)', novelId)
    execute('DELETE FROM outline_nodes WHERE novel_id = ?', novelId)
    execute('DELETE FROM chapter_extraction_candidates WHERE novel_id = ?', novelId)
    execute(
      `
        DELETE FROM chapter_extraction_processing_batches
        WHERE novel_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM chapter_extraction_candidates candidate
            WHERE candidate.processing_batch_id = chapter_extraction_processing_batches.id
          )
      `,
      novelId,
    )
    execute('DELETE FROM KnowledgeJob WHERE novelId = ?', novelId)
    execute('DELETE FROM NovelRecord WHERE id = ?', novelId)
  })
}

function countStructuredKnowledgeRows(novelId: string, branchId: string) {
  return queryOne<{ count: number }>(
    `
      SELECT (
        (SELECT COUNT(*) FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?)
        + (SELECT COUNT(*) FROM KnowledgeFact WHERE novelId = ? AND branchId = ?)
        + (SELECT COUNT(*) FROM KnowledgeRelation WHERE novelId = ? AND branchId = ?)
        + (SELECT COUNT(*) FROM EntityLink WHERE novelId = ? AND branchId = ?)
        + (SELECT COUNT(*) FROM EntityState WHERE novelId = ? AND branchId = ?)
        + (SELECT COUNT(*) FROM KnowledgeEvent WHERE novelId = ? AND branchId = ?)
        + (SELECT COUNT(*) FROM KnowledgeWorld WHERE novelId = ? AND branchId = ?)
      ) AS count
    `,
    novelId,
    branchId,
    novelId,
    branchId,
    novelId,
    branchId,
    novelId,
    branchId,
    novelId,
    branchId,
    novelId,
    branchId,
    novelId,
    branchId,
  )?.count ?? 0
}

async function performWorkspacePayloadToKnowledgeStoreSync(
  payload: WorkspaceKnowledgeSyncPayload,
  dependencies: WorkspaceKnowledgeSyncDependencies,
) {
  const novelMetaById = new Map((payload.localNovels ?? []).map((item) => [item.id, item]))
  const chapters = (payload.localChapters ?? [])
    .filter((chapter) => !chapter.parentChapterId)
    .slice()
    .sort((a, b) => a.order - b.order)

  const groupedByNovel = new Map<string, Chapter[]>()
  for (const chapter of chapters) {
    const current = groupedByNovel.get(chapter.novelId) ?? []
    current.push(chapter)
    groupedByNovel.set(chapter.novelId, current)
  }

  const desiredNovelIds = new Set(groupedByNovel.keys())
  const staleNovelIds = queryAll<{ id: string }>('SELECT id FROM NovelRecord').filter((row) => !desiredNovelIds.has(row.id))

  if (staleNovelIds.length) {
    for (const novel of staleNovelIds) {
      const branchId = getMainBranchId(novel.id)
      await dependencies.abortKnowledgeRebuildUntilIdle({ novelId: novel.id, branchId })
      await deleteBranchRetrievalIndex(branchId)
      await deleteNovelProjectionArtifacts(novel.id, branchId)
    }
  }

  if (!desiredNovelIds.size) {
    return
  }

  const orderedNovelIds = Array.from(groupedByNovel.keys()).sort((left, right) => {
    if (left === payload.currentNovelId) return -1
    if (right === payload.currentNovelId) return 1
    return 0
  })

  for (const novelId of orderedNovelIds) {
    const novelChapters = groupedByNovel.get(novelId) ?? []
    const branchId = getMainBranchId(novelId)
    const novelMeta = novelMetaById.get(novelId)
    upsertNovelRecord({
      novelId,
      title: novelMeta?.title?.trim() || novelChapters[0]?.title?.replace(/^第\s*[0-9一二三四五六七八九十百千零两]+\s*章\s*/, '') || novelId,
    })
    upsertStoryBranch(novelId, branchId, 'main')

    const existing = queryAll<KnowledgeChapterRow>(
      'SELECT id, novelId, branchId, chapterNo, title, rawText, revision, sourceHash FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
      novelId,
      branchId,
    )
    const desiredChapterIds = new Set(novelChapters.map((chapter) => chapter.id))
    const staleChapters = existing.filter((chapter) => !desiredChapterIds.has(chapter.id))
    const activeJob = queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN (\'queued\', \'running\', \'paused\') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1',
      novelId,
      branchId,
      'extract_chapter_knowledge',
    )

    if (staleChapters.length) {
      await withTransaction(async () => {
        for (const chapter of staleChapters) {
          execute('DELETE FROM KnowledgeChapter WHERE id = ?', chapter.id)
        }
      })
    }

    const existingById = new Map(existing.map((item) => [item.id, item]))
    const existingStructuredKnowledgeCount = countStructuredKnowledgeRows(novelId, branchId)
    const shouldBootstrapKnowledge = novelChapters.length > 0 && (existing.length === 0 || existingStructuredKnowledgeCount === 0)

    let firstChangedChapterNo: number | null = null

    for (let index = 0; index < novelChapters.length; index += 1) {
      const chapter = novelChapters[index]
      const chapterNo = index + 1
      const rawText = htmlToPlainText(chapter.content)
      const sourceHash = hashContent(rawText)
      const current = existingById.get(chapter.id)

      if (!current) {
        await withTransaction(() => {
          execute(
            `
              INSERT INTO KnowledgeChapter (
                id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'Created from workspace sync', ?, 'stale')
            `,
            chapter.id,
            novelId,
            branchId,
            chapterNo,
            chapter.title,
            rawText,
            sourceHash,
          )
          replaceKnowledgeChapterDerivedArtifacts({
            id: chapter.id,
            novelId,
            branchId,
            chapterNo,
            rawText,
          })
        })
        firstChangedChapterNo = firstChangedChapterNo === null ? chapterNo : Math.min(firstChangedChapterNo, chapterNo)
        continue
      }

      if (current.sourceHash === sourceHash && current.chapterNo === chapterNo && current.title === chapter.title) {
        await withTransaction(() => {
          ensureKnowledgeChapterDerivedArtifacts({
            id: current.id,
            novelId,
            branchId,
            chapterNo,
            rawText,
          })
        })
        continue
      }

      await withTransaction(() => {
        execute(
          `
            UPDATE KnowledgeChapter
            SET chapterNo = ?, title = ?, rawText = ?, sourceHash = ?, revision = ?, isDirty = 1,
                dirtyReason = 'Updated from workspace sync', knowledgeStatus = 'stale', updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          chapterNo,
          chapter.title,
          rawText,
          sourceHash,
          current.sourceHash === sourceHash ? current.revision : current.revision + 1,
          chapter.id,
        )
        replaceKnowledgeChapterDerivedArtifacts({
          id: chapter.id,
          novelId,
          branchId,
          chapterNo,
          rawText,
        })
      })
      firstChangedChapterNo = firstChangedChapterNo === null ? chapterNo : Math.min(firstChangedChapterNo, chapterNo)
    }

    const invalidationFromChapterNo = [
      firstChangedChapterNo,
      staleChapters.length ? Math.min(...staleChapters.map((chapter) => chapter.chapterNo)) : null,
    ].reduce<number | null>((current, value) => {
      if (value === null) return current
      if (current === null) return value
      return Math.min(current, value)
    }, null)

    if (shouldBootstrapKnowledge || staleChapters.length || firstChangedChapterNo !== null) {
      if (invalidationFromChapterNo !== null) {
        await markKnowledgeStaleFromChapter({
          novelId,
          branchId,
          fromChapterNo: invalidationFromChapterNo,
        })
      }

      if (activeJob?.id) {
        await dependencies.abortKnowledgeRebuildUntilIdle({ novelId, branchId })
      }
    }

    await bootstrapOutlineNodesForFutureMap({
      novelId,
      branchId,
      workspaceState: payload,
    })
  }
}

export function createWorkspaceKnowledgeSync(dependencies: WorkspaceKnowledgeSyncDependencies) {
  let workspaceKnowledgeSyncQueue: Promise<void> = Promise.resolve()

  return async function syncWorkspacePayloadToKnowledgeStore(payload: WorkspaceKnowledgeSyncPayload) {
    const run = workspaceKnowledgeSyncQueue.then(() => performWorkspacePayloadToKnowledgeStoreSync(payload, dependencies))
    workspaceKnowledgeSyncQueue = run.catch(() => undefined)
    return run
  }
}
