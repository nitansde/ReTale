import { roleplayMessageCreateSchema, roleplaySessionCreateSchema } from '@/lib/server/story-branch-contracts'
import { createStoryTimelineNode, findStoryTimelineNodeByRoleplaySessionId, getNextStoryTimelineLabelIndex } from '@/lib/server/story-timeline-store'
import {
  buildChildReadableLineageLabel,
  requireOptionalTimelineNodeInBranchContext,
} from '@/lib/server/story-branch-mutation-helpers'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/database-access'
import { formatStoryBranchReadableLabel } from '@/lib/story-branch-labels'
import type { RoleplayMessageRecord, RoleplaySessionDetail, RoleplaySessionRecord } from '@/lib/roleplay-types'
import { uid } from '@/lib/utils'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
  withTransaction: typeof withTransaction
}

const defaultDb: Db = { execute, queryAll, queryOne, withTransaction }

type ParsedRoleplayMessageCreate = ReturnType<typeof roleplayMessageCreateSchema.parse>

type RoleplaySessionRow = {
  id: string
  novel_id: string
  branch_id: string
  title: string
  subtitle: string | null
  source_chapter_id: string | null
  source_chapter_no: number
  source_chapter_title: string | null
  source_timeline_node_id: string | null
  source_timeline_node_type: RoleplaySessionRecord['sourceTimelineNodeType']
  source_selected_text: string
  source_text_snapshot: string
  source_selected_line_start: number | null
  source_selected_line_end: number | null
  status: string
  created_at: string
  updated_at: string
}

type RoleplayMessageRow = {
  id: string
  session_id: string
  message_index: number
  turn_index: number
  variant_index: number
  role: RoleplayMessageRecord['role']
  content: string
  parent_message_id: string | null
  forked_from_message_id: string | null
  variant_group_id: string | null
  status: string
  created_at: string
  updated_at: string
}

function toRoleplaySessionRecord(row: RoleplaySessionRow): RoleplaySessionRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    title: row.title,
    subtitle: row.subtitle,
    sourceChapterId: row.source_chapter_id,
    sourceChapterNo: row.source_chapter_no,
    sourceChapterTitle: row.source_chapter_title,
    sourceTimelineNodeId: row.source_timeline_node_id,
    sourceTimelineNodeType: row.source_timeline_node_type,
    sourceSelectedText: row.source_selected_text,
    sourceTextSnapshot: row.source_text_snapshot,
    sourceSelectedLineStart: row.source_selected_line_start,
    sourceSelectedLineEnd: row.source_selected_line_end,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRoleplayMessageRecord(row: RoleplayMessageRow): RoleplayMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageIndex: row.message_index,
    turnIndex: row.turn_index,
    variantIndex: row.variant_index,
    role: row.role,
    content: row.content,
    parentMessageId: row.parent_message_id,
    forkedFromMessageId: row.forked_from_message_id,
    variantGroupId: row.variant_group_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function listRoleplayMessages(sessionId: string, db: Db = defaultDb) {
  const rows = db.queryAll<RoleplayMessageRow>(
    `SELECT *
     FROM roleplay_messages
     WHERE session_id = ?
     ORDER BY message_index ASC, variant_index ASC, created_at ASC, id ASC`,
    sessionId
  )

  return rows.map(toRoleplayMessageRecord)
}

function findRoleplayMessageById(id: string, db: Db = defaultDb) {
  const row = db.queryOne<RoleplayMessageRow>('SELECT * FROM roleplay_messages WHERE id = ? LIMIT 1', id)
  return row ? toRoleplayMessageRecord(row) : null
}

function insertRoleplayMessage(input: ParsedRoleplayMessageCreate, db: Db) {
  db.execute(
    `INSERT INTO roleplay_messages (
      id, session_id, message_index, turn_index, variant_index, role, content,
      parent_message_id, forked_from_message_id, variant_group_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.sessionId,
    input.messageIndex,
    input.turnIndex,
    input.variantIndex,
    input.role,
    input.content,
    input.parentMessageId ?? null,
    input.forkedFromMessageId ?? null,
    input.variantGroupId ?? null,
    input.status
  )

  return findRoleplayMessageById(input.id, db)
}

function assertMessageBelongsToSession(messageId: string | null | undefined, sessionId: string, label: string, db: Db) {
  if (!messageId) return null
  const message = findRoleplayMessageById(messageId, db)
  if (!message) {
    throw new Error(`${label} not found: ${messageId}`)
  }
  if (message.sessionId !== sessionId) {
    throw new Error(`${label} does not belong to roleplay session: ${messageId}`)
  }
  return message
}

export function listRoleplaySessionsByNovel(novelId: string, db: Db = defaultDb) {
  const rows = db.queryAll<RoleplaySessionRow>(
    `SELECT *
     FROM roleplay_sessions
     WHERE novel_id = ?
     ORDER BY created_at DESC, id DESC`,
    novelId
  )

  return rows.map(toRoleplaySessionRecord)
}

export function findRoleplaySessionById(sessionId: string, db: Db = defaultDb): RoleplaySessionDetail | null {
  const row = db.queryOne<RoleplaySessionRow>('SELECT * FROM roleplay_sessions WHERE id = ? LIMIT 1', sessionId)
  if (!row) return null

  const timelineNode = findStoryTimelineNodeByRoleplaySessionId(sessionId, db)
  return {
    ...toRoleplaySessionRecord(row),
    timelineNodeId: timelineNode?.id ?? null,
    messages: listRoleplayMessages(sessionId, db),
  }
}

export function loadRoleplaySessionByNovel(sessionId: string, novelId: string, db: Db = defaultDb): RoleplaySessionDetail | null {
  const session = findRoleplaySessionById(sessionId, db)
  if (!session || session.novelId !== novelId) return null
  return session
}

export async function createRoleplaySession(
  rawInput: Omit<RoleplaySessionRecord, 'createdAt' | 'updatedAt'>,
  db: Db = defaultDb
) {
  const input = roleplaySessionCreateSchema.parse(rawInput)
  const timelineNodeId = uid('timeline-node')

  await db.withTransaction(async () => {
    const parentNode = requireOptionalTimelineNodeInBranchContext({
      nodeId: input.sourceTimelineNodeId,
      novelId: input.novelId,
      branchId: input.branchId,
      label: 'Source timeline node',
      db,
    })
    const labelIndex = getNextStoryTimelineLabelIndex(input.novelId, input.branchId, 'roleplay_session', db)
    const readableLabel = formatStoryBranchReadableLabel('roleplay_session', labelIndex)
    const readableLineageLabel = buildChildReadableLineageLabel(parentNode, readableLabel)

    db.execute(
      `INSERT INTO roleplay_sessions (
        id, novel_id, branch_id, title, subtitle, source_chapter_id, source_chapter_no,
        source_chapter_title, source_timeline_node_id, source_timeline_node_type,
        source_selected_text, source_text_snapshot, source_selected_line_start,
        source_selected_line_end, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.novelId,
      input.branchId,
      input.title,
      input.subtitle ?? null,
      input.sourceChapterId,
      input.sourceChapterNo,
      input.sourceChapterTitle ?? null,
      input.sourceTimelineNodeId ?? null,
      input.sourceTimelineNodeType ?? null,
      input.sourceSelectedText,
      input.sourceTextSnapshot,
      input.sourceSelectedLineStart ?? null,
      input.sourceSelectedLineEnd ?? null,
      input.status
    )

    createStoryTimelineNode({
      id: timelineNodeId,
      novelId: input.novelId,
      branchId: input.branchId,
      nodeType: 'roleplay_session',
      labelIndex,
      readableLabel,
      readableLineageLabel,
      anchorChapterNo: input.sourceChapterNo,
      title: input.title,
      subtitle: input.subtitle ?? null,
      parentNodeId: input.sourceTimelineNodeId ?? null,
      sourceChapterNo: input.sourceChapterNo,
      targetChapterNo: null,
      chapterId: input.sourceChapterId,
      continueBlockId: null,
      whatIfSessionId: null,
      futureJumpRunId: null,
      roleplaySessionId: input.id,
      laneIndex: 0,
      colorToken: 'amber',
      status: input.status,
    }, db)
  })

  const session = findRoleplaySessionById(input.id, db)
  if (!session) {
    throw new Error(`Failed to create roleplay session: ${input.id}`)
  }

  return {
    session,
    timelineNodeId,
  }
}

export async function appendRoleplayMessage(
  rawInput: Omit<RoleplayMessageRecord, 'createdAt' | 'updatedAt' | 'messageIndex' | 'turnIndex' | 'variantIndex'> & {
    messageIndex?: number
    turnIndex?: number
    variantIndex?: number
  },
  db: Db = defaultDb
) {
  return db.withTransaction(() => {
    const session = findRoleplaySessionById(rawInput.sessionId, db)
    if (!session) {
      throw new Error(`Roleplay session not found: ${rawInput.sessionId}`)
    }

    const validatedParent = assertMessageBelongsToSession(rawInput.parentMessageId, rawInput.sessionId, 'Parent message', db)
    const validatedFork = assertMessageBelongsToSession(rawInput.forkedFromMessageId, rawInput.sessionId, 'Fork source message', db)
    const nextMessageIndexRow = db.queryOne<{ next_message_index: number }>(
      'SELECT COALESCE(MAX(message_index), 0) + 1 AS next_message_index FROM roleplay_messages WHERE session_id = ?',
      rawInput.sessionId
    )
    const nextTurnIndexRow = db.queryOne<{ next_turn_index: number }>(
      'SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn_index FROM roleplay_messages WHERE session_id = ?',
      rawInput.sessionId
    )
    const input = roleplayMessageCreateSchema.parse({
      ...rawInput,
      messageIndex: rawInput.messageIndex ?? nextMessageIndexRow?.next_message_index ?? 1,
      turnIndex: rawInput.turnIndex ?? nextTurnIndexRow?.next_turn_index ?? 1,
      variantIndex: rawInput.variantIndex ?? 1,
      parentMessageId: validatedParent?.id ?? rawInput.parentMessageId ?? null,
      forkedFromMessageId: validatedFork?.id ?? rawInput.forkedFromMessageId ?? null,
      variantGroupId: rawInput.variantGroupId ?? null,
      status: rawInput.status ?? 'active',
    })
    const message = insertRoleplayMessage(input, db)
    if (!message) {
      throw new Error(`Failed to append roleplay message: ${input.id}`)
    }
    return message
  })
}

export async function createRoleplayLatestTurnVariant(
  input: {
    sessionId: string
    role: RoleplayMessageRecord['role']
    content: string
    parentMessageId?: string | null
    forkedFromMessageId?: string | null
    status?: string
  },
  db: Db = defaultDb
) {
  return db.withTransaction(() => {
    const session = findRoleplaySessionById(input.sessionId, db)
    if (!session) {
      throw new Error(`Roleplay session not found: ${input.sessionId}`)
    }

    const latestMessage = session.messages.at(-1)
    if (!latestMessage) {
      throw new Error(`Cannot create latest-turn variant without messages: ${input.sessionId}`)
    }
    if (input.role !== latestMessage.role) {
      throw new Error(`Latest-turn variant role must match latest message role: expected ${latestMessage.role}`)
    }

    const variantGroupId = latestMessage.variantGroupId ?? uid('roleplay-variant-group')
    const nextMessageIndexRow = db.queryOne<{ next_message_index: number }>(
      'SELECT COALESCE(MAX(message_index), 0) + 1 AS next_message_index FROM roleplay_messages WHERE session_id = ?',
      input.sessionId
    )
    const nextVariantIndexRow = db.queryOne<{ next_variant_index: number }>(
      `SELECT COALESCE(MAX(variant_index), 0) + 1 AS next_variant_index
       FROM roleplay_messages
       WHERE session_id = ? AND turn_index = ?`,
      input.sessionId,
      latestMessage.turnIndex
    )
    if (!latestMessage.variantGroupId) {
      db.execute(
        `UPDATE roleplay_messages
         SET variant_group_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND turn_index = ? AND variant_group_id IS NULL`,
        variantGroupId,
        input.sessionId,
        latestMessage.turnIndex
      )
    }

    const parentMessageId = input.parentMessageId ?? latestMessage.parentMessageId
    const forkedFromMessageId = input.forkedFromMessageId ?? latestMessage.id
    const validatedParent = assertMessageBelongsToSession(parentMessageId, input.sessionId, 'Parent message', db)
    const validatedFork = assertMessageBelongsToSession(forkedFromMessageId, input.sessionId, 'Fork source message', db)
    const variantInput = roleplayMessageCreateSchema.parse({
      id: uid('roleplay-message'),
      sessionId: input.sessionId,
      messageIndex: nextMessageIndexRow?.next_message_index ?? latestMessage.messageIndex + 1,
      turnIndex: latestMessage.turnIndex,
      variantIndex: nextVariantIndexRow?.next_variant_index ?? latestMessage.variantIndex + 1,
      role: input.role,
      content: input.content,
      parentMessageId: validatedParent?.id ?? null,
      forkedFromMessageId: validatedFork?.id ?? null,
      variantGroupId,
      status: input.status ?? latestMessage.status,
    })
    const variantMessage = insertRoleplayMessage(variantInput, db)
    if (!variantMessage) {
      throw new Error(`Failed to create latest-turn variant: ${input.sessionId}`)
    }
    return variantMessage
  })
}
