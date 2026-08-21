import { NextResponse } from 'next/server'
import {
  DELETE as deleteLegacyWorkspace,
  GET as getLegacyWorkspace,
  POST as saveLegacyWorkspace,
} from '@/app/api/workspace/route'

export const maxDuration = 3600

async function readNovelId(context: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await context.params
  return novelId.trim()
}

function forwardRequestWithHeaders(request: Request, headers: Headers) {
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    duplex: 'half',
  }
  return new Request(request.url, init)
}

const DEDUPED_CHAPTER_CONTENT_ENCODING = 'original-content-equals-content-v1'

function compactChapterContentForTransport(value: unknown) {
  if (!Array.isArray(value)) return { chapters: value, compacted: false }

  let compacted = false
  const chapters = value.map((chapter) => {
    if (typeof chapter !== 'object' || chapter === null || Array.isArray(chapter)) return chapter
    const record = chapter as Record<string, unknown>
    if (typeof record.content !== 'string' || record.originalContent !== record.content) return chapter
    const compactedChapter = { ...record }
    delete compactedChapter.originalContent
    compacted = true
    return compactedChapter
  })

  return { chapters, compacted }
}

async function toNovelResourceResponse(response: Response) {
  if (!response.ok) return response
  const payload = await response.json() as Record<string, unknown>
  const {
    currentNovelId: _currentNovelId,
    currentChapterId: _currentChapterId,
    currentTab: _currentTab,
    helperTab: _helperTab,
    focusMode: _focusMode,
    selectionText: _selectionText,
    selectedParagraphIndex: _selectedParagraphIndex,
    aiSettings: _aiSettings,
    expandedVolumeIds: _expandedVolumeIds,
    localVolumes: _localVolumes,
    ...resource
  } = payload
  const compactedChapterContent = compactChapterContentForTransport(resource.localChapters)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json({
    ...resource,
    localChapters: compactedChapterContent.chapters,
    ...(compactedChapterContent.compacted
      ? { chapterContentEncoding: DEDUPED_CHAPTER_CONTENT_ENCODING }
      : {}),
  }, {
    status: response.status,
    headers,
  })
}

export async function GET(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })

  const incoming = new URL(request.url)
  const url = new URL('/api/workspace', request.url)
  url.searchParams.set('novelId', novelId)
  if (incoming.searchParams.has('deletionStatus')) {
    url.searchParams.set('deletionStatus', incoming.searchParams.get('deletionStatus') ?? '')
  }
  const response = await getLegacyWorkspace(new Request(url, {
    headers: request.headers,
    signal: request.signal,
  }))
  return incoming.searchParams.has('deletionStatus') ? response : toNovelResourceResponse(response)
}

export async function POST(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
  const headers = new Headers(request.headers)
  headers.set('X-Retale-Resource-Novel-Id', novelId)
  return saveLegacyWorkspace(forwardRequestWithHeaders(request, headers))
}

export async function DELETE(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })

  const incoming = new URL(request.url)
  const url = new URL('/api/workspace', request.url)
  url.searchParams.set('novelId', novelId)
  const nextNovelId = incoming.searchParams.get('nextNovelId')
  if (nextNovelId !== null) url.searchParams.set('nextNovelId', nextNovelId)
  const headers = new Headers(request.headers)
  headers.set('X-Retale-Resource-Delete', '1')
  const response = await deleteLegacyWorkspace(new Request(url, {
    method: 'DELETE',
    headers,
    signal: request.signal,
  }))
  if (!response.ok) return response
  const payload = await response.json() as Record<string, unknown>
  const { activeNovelId, ...result } = payload
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-length')
  return Response.json({ ...result, nextNovelId: activeNovelId }, {
    status: response.status,
    headers: responseHeaders,
  })
}
