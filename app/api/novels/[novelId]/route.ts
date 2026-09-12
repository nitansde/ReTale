import { NextResponse } from 'next/server'
import { revalidatedCompressedJson } from '@/lib/server/compressed-json'
import {
  deleteNovelResource,
  getNovelResource,
  saveNovelResource,
  updateNovelLibraryMetadata,
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

async function toNovelResourceResponse(request: Request, response: Response) {
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
  const search = new URL(request.url).searchParams
  const view = search.get('view')
  if (view === 'chapter' || view === 'chapters') {
    return revalidatedCompressedJson(request, payload, { headers: response.headers })
  }
  if (view === 'workspace' && Array.isArray(resource.localChapters)) {
    const chapters = resource.localChapters as Array<Record<string, unknown>>
    const selected = chapters.find((chapter) => chapter.id === search.get('chapterId'))
      ?? chapters.slice().sort((a, b) => Number(Boolean(a.parentChapterId)) - Number(Boolean(b.parentChapterId))
        || Number(a.order) - Number(b.order) || String(a.id).localeCompare(String(b.id)))[0]
    resource.localChapters = chapters.map((chapter) => chapter === selected ? chapter : {
      ...chapter, content: '', originalContent: undefined, contentLoaded: false,
    })
  }
  const compactedChapterContent = compactChapterContentForTransport(resource.localChapters)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return revalidatedCompressedJson(request, {
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
  return new URL(request.url).searchParams.has('deletionStatus') ? response : toNovelResourceResponse(request, response)
}

export async function POST(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
  return saveNovelResource(request, novelId)
}

export async function PATCH(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
  return updateNovelLibraryMetadata(request, novelId)
}

export async function DELETE(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const novelId = await readNovelId(context)
  if (!novelId) return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })

  return deleteNovelResource(request, novelId)
}
