import { NextResponse } from 'next/server'
import { importNovelIntoWorkspace } from '@/lib/server/import-txt'
import {
  backfillWorkspaceRuntimeFromArtifactIfMissing,
  loadWorkspacePayloadFromRuntimeOrRecovery,
} from '@/lib/server/workspace-resilience'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import { scopeWorkspaceStateToNovel } from '@/lib/server/workspace-novel-scope'
import { createWorkspaceNovelFromSnapshot } from '@/lib/server/workspace-mutation'
import {
  ApiRequestError,
  assertMultipartFormDataMediaType,
  assertNormalizedWorkspaceSnapshotSemantics,
  assertSameOriginRequest,
  createByteLimitedRequest,
} from '@/lib/server/api-route'

export const maxDuration = 3600

const MAX_TXT_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_IMPORT_BODY_SIZE_BYTES = MAX_TXT_FILE_SIZE_BYTES + 256 * 1024

class TxtFileSizeLimitError extends Error {
  constructor() {
    super('TXT file exceeds 10 MiB')
    this.name = 'TxtFileSizeLimitError'
  }
}

function importTooLargeResponse(error: TxtFileSizeLimitError) {
  return NextResponse.json(
    { ok: false, error: error.message },
    { status: 413 }
  )
}

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return Number.POSITIVE_INFINITY

  const replacementChars = countMatches(text, /�/g)
  const privateUseChars = countMatches(text, /[\uE000-\uF8FF]/g)
  const suspiciousLatinChars = countMatches(text, /[ÃÂÄÅÆ]/g)
  const suspiciousCjkMojibakeChars = countMatches(text, /[鏈鐨銆锛紝鍦涓鏄]/g)
  const euroChars = countMatches(text, /€/g)
  const greekOrCyrillicChars = countMatches(text, /[\u0370-\u03FF\u0400-\u04FF]/g)

  return replacementChars * 40
    + privateUseChars * 16
    + euroChars * 8
    + greekOrCyrillicChars * 8
    + suspiciousLatinChars * 6
    + suspiciousCjkMojibakeChars * 4
}

async function decodeTextFile(file: File) {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const candidates = [{ text: utf8, score: scoreDecodedText(utf8) }]

  try {
    const gb = new TextDecoder('gb18030', { fatal: false }).decode(buffer)
    candidates.push({ text: gb, score: scoreDecodedText(gb) })
  } catch (error) {
    void error
  }

  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]?.text ?? utf8
}

async function ensureWorkspacePayload() {
  await backfillWorkspaceRuntimeFromArtifactIfMissing('singleton')
  return loadWorkspacePayloadFromRuntimeOrRecovery('singleton')
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request)
    assertMultipartFormDataMediaType(request)
    const limitedRequest = createByteLimitedRequest(request, MAX_IMPORT_BODY_SIZE_BYTES, 'TXT import request body exceeds 10.25 MiB')
    const formData = await limitedRequest.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 })
    }
    if (file.size > MAX_TXT_FILE_SIZE_BYTES) {
      throw new TxtFileSizeLimitError()
    }

    const text = await decodeTextFile(file)
    if (!text.trim()) {
      return NextResponse.json({ ok: false, error: 'Empty file' }, { status: 400 })
    }

    const currentState = await ensureWorkspacePayload()
    const nextState = normalizeWorkspaceState(importNovelIntoWorkspace(currentState, {
      title: file.name.replace(/\.[^.]+$/, ''),
      text,
      summary: `从 ${file.name} 导入`,
    }))
    const targetNovelId = nextState.currentNovelId
    if (!targetNovelId) {
      throw new Error('Imported workspace is missing its target novel')
    }
    const scopedState = scopeWorkspaceStateToNovel(nextState, targetNovelId)
    assertNormalizedWorkspaceSnapshotSemantics(scopedState)

    const result = await createWorkspaceNovelFromSnapshot({
      novelId: targetNovelId,
      payload: scopedState,
      title: scopedState.localNovels[0]?.title ?? null,
    })
    return NextResponse.json({
      ok: true,
      novelId: targetNovelId,
      chapterId: scopedState.currentChapterId,
      chapterCount: scopedState.localChapters.filter((item: { parentChapterId?: string }) => !item.parentChapterId).length,
      revision: result.revision,
    }, { headers: {
      'X-Retale-Workspace-Revision': String(result.revision),
      'X-Retale-Revision-Novel-Id': targetNovelId,
    } })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    if (error instanceof TxtFileSizeLimitError) {
      return importTooLargeResponse(error)
    }

    console.error('Import error:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to import TXT workspace' },
      { status: 500 }
    )
  }
}
