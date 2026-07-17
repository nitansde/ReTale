import { NextResponse } from 'next/server'
import { importNovelIntoWorkspace } from '@/lib/server/import-txt'
import { upsertWorkspaceState } from '@/lib/server/persistence'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import {
  backfillWorkspaceRuntimeFromArtifactIfMissing,
  loadWorkspacePayloadFromRuntimeOrRecovery,
  persistWorkspaceRuntimeState,
} from '@/lib/server/workspace-resilience'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import { scopeWorkspaceStateToNovel } from '@/lib/server/workspace-novel-scope'

const MAX_TXT_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_IMPORT_BODY_SIZE_BYTES = MAX_TXT_FILE_SIZE_BYTES + 256 * 1024

class ImportRequestBodySizeLimitError extends Error {
  constructor() {
    super('TXT import request body exceeds 10.25 MiB')
    this.name = 'ImportRequestBodySizeLimitError'
  }
}

class TxtFileSizeLimitError extends Error {
  constructor() {
    super('TXT file exceeds 10 MiB')
    this.name = 'TxtFileSizeLimitError'
  }
}

function importTooLargeResponse(error: ImportRequestBodySizeLimitError | TxtFileSizeLimitError) {
  return NextResponse.json(
    { ok: false, error: error.message },
    { status: 413 }
  )
}

function createSizeLimitedBody(source: ReadableStream<Uint8Array>) {
  const reader = source.getReader()
  let bytesRead = 0

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }

        if (bytesRead + value.byteLength > MAX_IMPORT_BODY_SIZE_BYTES) {
          const error = new ImportRequestBodySizeLimitError()
          await reader.cancel(error).catch(() => undefined)
          controller.error(error)
          return
        }

        bytesRead += value.byteLength
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}

function createSizeLimitedRequest(request: Request) {
  const headers = new Headers(request.headers)
  headers.delete('content-length')

  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body: request.body ? createSizeLimitedBody(request.body) : null,
    signal: request.signal,
    duplex: 'half',
  }

  return new Request(request.url, init)
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
  } catch {
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
    const declaredBodySize = Number(request.headers.get('content-length'))
    if (Number.isFinite(declaredBodySize) && declaredBodySize > MAX_IMPORT_BODY_SIZE_BYTES) {
      return importTooLargeResponse(new ImportRequestBodySizeLimitError())
    }

    const formData = await createSizeLimitedRequest(request).formData()
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

    await persistWorkspaceRuntimeState(scopedState)
    const workspaceDb = createNovelDatabaseAccess(targetNovelId)
    upsertWorkspaceState('singleton', JSON.stringify(scopedState), {
      backupReason: 'import-txt',
      novelId: targetNovelId,
      db: workspaceDb,
    })
    await syncWorkspacePayloadToKnowledgeStore({
      ...scopedState,
      syncScope: 'target-novel',
    }, { db: workspaceDb })

    return NextResponse.json({
      ok: true,
      novelId: targetNovelId,
      chapterId: scopedState.currentChapterId,
      chapterCount: scopedState.localChapters.filter((item: { parentChapterId?: string }) => !item.parentChapterId).length,
    })
  } catch (error) {
    if (error instanceof ImportRequestBodySizeLimitError || error instanceof TxtFileSizeLimitError) {
      return importTooLargeResponse(error)
    }

    console.error('Import error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
