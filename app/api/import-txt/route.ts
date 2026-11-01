import { NextResponse } from 'next/server'
import { decodeTextFile } from '@/lib/server/decode-text-file'
import { importNovelIntoWorkspace } from '@/lib/server/import-txt'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'
import { scopeWorkspaceStateToNovel } from '@/lib/server/workspace-novel-scope'
import { createWorkspaceNovelFromSnapshot } from '@/lib/server/workspace-mutation'
import {
  ApiRequestError,
  assertMultipartFormDataMediaType,
  assertWorkspaceSnapshotSemantics,
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

export async function POST(request: Request) {
  try {
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

    const currentState = createEmptyWorkspaceState()
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
    assertWorkspaceSnapshotSemantics(scopedState)

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
