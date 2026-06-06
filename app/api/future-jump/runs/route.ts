import { NextResponse } from 'next/server'
import { isNotFoundErrorMessage, jsonError, readJsonObject, toErrorMessage } from '@/lib/server/api-route'
import { createFutureJumpRun } from '@/lib/server/future-jump-service'
import type { FutureJumpCreateRequest, FutureJumpSourceContext } from '@/lib/story-branch-types'

function parsePositiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeSourceContext(body: Record<string, unknown>): FutureJumpSourceContext {
  const validNodeTypes = ['chapter', 'rewrite', 'continue_block', 'what_if', 'future_jump'] as const

  const nested = body.sourceContext
  if (nested && typeof nested === 'object') {
    const record = nested as Record<string, unknown>
    const chapterNo = parsePositiveInteger(record.chapterNo)
    if (!chapterNo) {
      throw new Error('sourceContext.chapterNo must be a positive integer')
    }
    const nodeType = typeof record.nodeType === 'string' && validNodeTypes.includes(record.nodeType as typeof validNodeTypes[number])
      ? record.nodeType as FutureJumpSourceContext['nodeType']
      : null
    if (!nodeType) {
      throw new Error('sourceContext.nodeType is invalid')
    }

    return {
      nodeId: typeof record.nodeId === 'string' ? record.nodeId : null,
      nodeType,
      chapterId: typeof record.chapterId === 'string' ? record.chapterId : null,
      chapterNo,
      whatIfSessionId: typeof record.whatIfSessionId === 'string' ? record.whatIfSessionId : null,
    }
  }

  const chapterNo = parsePositiveInteger(body.sourceChapterNo)
  if (!chapterNo) {
    throw new Error('sourceContext.chapterNo must be a positive integer')
  }

  return {
    nodeId: typeof body.sourceNodeId === 'string' ? body.sourceNodeId : null,
    nodeType: typeof body.sourceNodeType === 'string' && validNodeTypes.includes(body.sourceNodeType as typeof validNodeTypes[number])
      ? body.sourceNodeType as FutureJumpSourceContext['nodeType']
      : 'chapter',
    chapterId: typeof body.sourceChapterId === 'string' ? body.sourceChapterId : null,
    chapterNo,
    whatIfSessionId: typeof body.sessionId === 'string'
      ? body.sessionId
      : typeof body.whatIfSessionId === 'string'
        ? body.whatIfSessionId
        : null,
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request)
    const result = await createFutureJumpRun({
      sourceContext: normalizeSourceContext(body),
      targetOutlineNodeId: String(body.targetOutlineNodeId ?? ''),
      targetOutlineChapterId: String(body.targetOutlineChapterId ?? ''),
      parentTimelineNodeId: typeof body.parentTimelineNodeId === 'string' ? body.parentTimelineNodeId : null,
      userDirection: typeof body.userDirection === 'string' ? body.userDirection : null,
    } satisfies FutureJumpCreateRequest)

    return NextResponse.json(result)
  } catch (error) {
    const message = toErrorMessage(error, 'Failed to create future jump run')
    return jsonError(message, isNotFoundErrorMessage(message) ? 404 : 400)
  }
}
