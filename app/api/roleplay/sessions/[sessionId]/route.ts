import { NextResponse } from 'next/server'
import { queryAll, queryOne } from '@/lib/server/sqlite'
import type { RoleplayMessageRecord, RoleplaySessionDetail } from '@/lib/roleplay-types'

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
  source_timeline_node_type: RoleplaySessionDetail['sourceTimelineNodeType'] | null
  source_selected_text: string
  source_text_snapshot: string
  source_selected_line_start: number | null
  source_selected_line_end: number | null
  status: string
  created_at: string
  updated_at: string
  timeline_node_id: string | null
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

function toRoleplaySessionDetail(row: RoleplaySessionRow, messages: RoleplayMessageRow[]): RoleplaySessionDetail {
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
    timelineNodeId: row.timeline_node_id,
    messages: messages.map((message) => ({
      id: message.id,
      sessionId: message.session_id,
      messageIndex: message.message_index,
      turnIndex: message.turn_index,
      variantIndex: message.variant_index,
      role: message.role,
      content: message.content,
      parentMessageId: message.parent_message_id,
      forkedFromMessageId: message.forked_from_message_id,
      variantGroupId: message.variant_group_id,
      status: message.status,
      createdAt: message.created_at,
      updatedAt: message.updated_at,
    })),
  }
}

function toRoleplaySessionPayload(session: RoleplaySessionDetail) {
  return {
    ...session,
    sourceSnapshot: {
      chapterId: session.sourceChapterId,
      chapterNo: session.sourceChapterNo,
      chapterTitle: session.sourceChapterTitle,
      timelineNodeId: session.sourceTimelineNodeId,
      timelineNodeType: session.sourceTimelineNodeType,
      selectedText: session.sourceSelectedText,
      textSnapshot: session.sourceTextSnapshot,
      selectedLineStart: session.sourceSelectedLineStart,
      selectedLineEnd: session.sourceSelectedLineEnd,
    },
    messages: session.messages.map((message) => ({
      ...message,
      variantMetadata: {
        turnIndex: message.turnIndex,
        variantIndex: message.variantIndex,
        variantGroupId: message.variantGroupId,
      },
      forkMetadata: {
        parentMessageId: message.parentMessageId,
        forkedFromMessageId: message.forkedFromMessageId,
      },
    })),
  }
}

export async function GET(request: Request, ctx: RouteContext<'/api/roleplay/sessions/[sessionId]'>) {
  try {
    const { sessionId } = await ctx.params
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const branchId = searchParams.get('branchId')?.trim() ?? ''

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!branchId) {
      return NextResponse.json({ ok: false, error: 'branchId is required' }, { status: 400 })
    }

    const session = queryOne<RoleplaySessionRow>(
      `SELECT
         roleplay_sessions.*,
         (
           SELECT story_timeline_nodes.id
           FROM story_timeline_nodes
           WHERE story_timeline_nodes.roleplay_session_id = roleplay_sessions.id
           LIMIT 1
         ) AS timeline_node_id
       FROM roleplay_sessions
       WHERE roleplay_sessions.id = ?
       LIMIT 1`,
      sessionId
    )

    if (!session || session.novel_id !== novelId || session.branch_id !== branchId) {
      return NextResponse.json({ ok: false, error: 'Roleplay session not found for the requested branch context' }, { status: 404 })
    }

    const messages = queryAll<RoleplayMessageRow>(
      `SELECT *
       FROM roleplay_messages
       WHERE session_id = ?
       ORDER BY message_index ASC, id ASC`,
      sessionId
    )

    return NextResponse.json(toRoleplaySessionPayload(toRoleplaySessionDetail(session, messages)))
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load roleplay session' },
      { status: 500 }
    )
  }
}
