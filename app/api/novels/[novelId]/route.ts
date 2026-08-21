import { NextResponse } from 'next/server'
import {
  deleteNovelResource,
  getNovelResource,
  saveNovelResource,
} from '@/lib/server/novel-resource-handlers'

export const maxDuration = 3600

async function readNovelId(context: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await context.params
  return novelId.trim()
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
    presetCompatSessionState: _presetCompatSessionState,
    aiSettings: _aiSettings,
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

  const response = await getNovelResource(request, novelId)
  return new URL(request.url).searchParams.has('deletionStatus') ? response : toNovelResourceResponse(response)
}

export async function POST(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
  return saveNovelResource(request, novelId)
}

export async function DELETE(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })

  return deleteNovelResource(request, novelId)
}
