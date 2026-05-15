import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/sqlite'
import { deleteStoryTimelineNodesByIds, findStoryTimelineNodeByFutureJumpRunId } from '@/lib/server/story-timeline-store'
import type {
  FutureJumpRevisionHistoryItem,
  FutureJumpRevisionRecord,
  FutureJumpRunDetail,
  FutureJumpRunRecord,
} from '@/lib/story-branch-types'
import { uid } from '@/lib/utils'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
  withTransaction: typeof withTransaction
}

const defaultDb: Db = { execute, queryAll, queryOne, withTransaction }

type FutureJumpRunRow = {
  id: string
  session_id: string
  base_branch_id: string
  parent_timeline_node_id: string | null
  target_outline_node_id: string
  target_outline_chapter_id: string
  source_chapter_no: number
  target_chapter_no: number
  user_direction: string
  bridge_summary: string
  generated_target_text: string
  latest_revision_no: number
  error_message: string | null
  status: string
  created_at: string
  updated_at: string
}

type FutureJumpRevisionRow = {
  id: string
  run_id: string
  revision_no: number
  revision_kind: string
  user_feedback: string | null
  bridge_summary: string
  generated_target_text: string
  created_at: string
}

function toFutureJumpRunRecord(row: FutureJumpRunRow): FutureJumpRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    baseBranchId: row.base_branch_id,
    parentTimelineNodeId: row.parent_timeline_node_id,
    targetOutlineNodeId: row.target_outline_node_id,
    targetOutlineChapterId: row.target_outline_chapter_id,
    sourceChapterNo: row.source_chapter_no,
    targetChapterNo: row.target_chapter_no,
    userDirection: row.user_direction,
    bridgeSummary: row.bridge_summary,
    generatedTargetText: row.generated_target_text,
    latestRevisionNo: row.latest_revision_no,
    errorMessage: row.error_message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toFutureJumpRevisionRecord(row: FutureJumpRevisionRow): FutureJumpRevisionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    revisionNo: row.revision_no,
    revisionKind: row.revision_kind,
    userFeedback: row.user_feedback,
    bridgeSummary: row.bridge_summary,
    generatedTargetText: row.generated_target_text,
    createdAt: row.created_at,
  }
}

function toFutureJumpRevisionHistoryItem(revision: FutureJumpRevisionRecord): FutureJumpRevisionHistoryItem {
  return {
    revisionNo: revision.revisionNo,
    revisionKind: revision.revisionKind,
    userFeedback: revision.userFeedback,
    createdAt: revision.createdAt,
  }
}

export function listFutureJumpRevisions(runId: string, db: Db = defaultDb) {
  const rows = db.queryAll<FutureJumpRevisionRow>(
    'SELECT * FROM future_jump_revisions WHERE run_id = ? ORDER BY revision_no ASC',
    runId
  )

  return rows.map(toFutureJumpRevisionRecord)
}

export function findFutureJumpRunById(id: string, db: Db = defaultDb): FutureJumpRunDetail | null {
  const row = db.queryOne<FutureJumpRunRow>('SELECT * FROM future_jump_runs WHERE id = ?', id)
  if (!row) return null

  const revisions = listFutureJumpRevisions(id, db)
  const latestRevision = revisions.at(-1) ?? null
  const timelineNode = findStoryTimelineNodeByFutureJumpRunId(id, db)

  return {
    ...toFutureJumpRunRecord(row),
    timelineNodeId: timelineNode?.id ?? null,
    latestRevision,
    revisionHistory: revisions.map(toFutureJumpRevisionHistoryItem),
    revisions,
  }
}

export function listFutureJumpRunsBySessionId(sessionId: string, db: Db = defaultDb) {
  const rows = db.queryAll<FutureJumpRunRow>(
    'SELECT * FROM future_jump_runs WHERE session_id = ? ORDER BY created_at ASC, id ASC',
    sessionId
  )

  return rows.map(toFutureJumpRunRecord)
}

export function createFutureJumpRun(input: Omit<FutureJumpRunRecord, 'createdAt' | 'updatedAt'>, db: Db = defaultDb) {
  db.execute(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.sessionId,
    input.baseBranchId,
    input.parentTimelineNodeId,
    input.targetOutlineNodeId,
    input.targetOutlineChapterId,
    input.sourceChapterNo,
    input.targetChapterNo,
    input.userDirection,
    input.bridgeSummary,
    input.generatedTargetText,
    input.latestRevisionNo,
    input.errorMessage,
    input.status,
  )

  return findFutureJumpRunById(input.id, db)
}

export async function createFutureJumpRunWithInitialRevision(
  input: Omit<FutureJumpRunRecord, 'createdAt' | 'updatedAt'>,
  db: Db = defaultDb
) {
  await db.withTransaction(async () => {
    db.execute(
      `INSERT INTO future_jump_runs (
        id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
        target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
        bridge_summary, generated_target_text, latest_revision_no, error_message, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.sessionId,
      input.baseBranchId,
      input.parentTimelineNodeId,
      input.targetOutlineNodeId,
      input.targetOutlineChapterId,
      input.sourceChapterNo,
      input.targetChapterNo,
      input.userDirection,
      input.bridgeSummary,
      input.generatedTargetText,
      input.latestRevisionNo,
      input.errorMessage,
      input.status
    )

    db.execute(
      `INSERT INTO future_jump_revisions (
        id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
      ) VALUES (?, ?, 1, 'initial', NULL, ?, ?)`,
      uid('future-jump-revision'),
      input.id,
      input.bridgeSummary,
      input.generatedTargetText
    )
  })

  return findFutureJumpRunById(input.id, db)
}

export async function appendFutureJumpRevision(
  input: {
    runId: string
    revisionKind: string
    userFeedback: string | null
    bridgeSummary: string
    generatedTargetText: string
    status?: string
  },
  db: Db = defaultDb
) {
  await db.withTransaction(async () => {
    const row = db.queryOne<{ next_revision_no: number }>(
      'SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_revision_no FROM future_jump_revisions WHERE run_id = ?',
      input.runId
    )
    const nextRevisionNo = row?.next_revision_no ?? 1

    db.execute(
      `INSERT INTO future_jump_revisions (
        id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      uid('future-jump-revision'),
      input.runId,
      nextRevisionNo,
      input.revisionKind,
      input.userFeedback,
      input.bridgeSummary,
      input.generatedTargetText
    )

    db.execute(
      `UPDATE future_jump_runs
       SET latest_revision_no = ?, bridge_summary = ?, generated_target_text = ?, error_message = NULL, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      nextRevisionNo,
      input.bridgeSummary,
      input.generatedTargetText,
      input.status ?? 'revised',
      input.runId
    )
  })

  return findFutureJumpRunById(input.runId, db)
}

export function markFutureJumpRunFailed(runId: string, errorMessage: string, db: Db = defaultDb) {
  db.execute(
    'UPDATE future_jump_runs SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    'failed',
    errorMessage,
    runId
  )

  return findFutureJumpRunById(runId, db)
}

export async function deleteFutureJumpRun(runId: string, db: Db = defaultDb) {
  const run = findFutureJumpRunById(runId, db)
  if (!run) return null

  await db.withTransaction(async () => {
    if (run.timelineNodeId) {
      deleteStoryTimelineNodesByIds([run.timelineNodeId], db)
    }

    db.execute('DELETE FROM future_jump_runs WHERE id = ?', runId)
  })

  return run
}
