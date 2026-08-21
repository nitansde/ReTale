import type { Page, Route } from '@playwright/test'
import type { PersistedNovelState } from '@/lib/types'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

type MockNovel = {
  id: string
  title: string
  summary?: string
  tags?: string[]
  updatedAt?: string
  wordCount?: number
  chapterCount?: number
}

type MockChapter = {
  id: string
  novelId: string
  order: number
  wordCount?: number
  updatedAt?: string
  content?: string
}

export type MockNovelResourceWorkspace = Record<string, unknown> & {
  currentNovelId?: string | null
  currentChapterId?: string | null
  localNovels: MockNovel[]
  localChapters: MockChapter[]
}

export type MockNovelResourceMutation = {
  kind: 'novel' | 'chapter'
  id: string
  method: string
  novelId: string
  payload: Record<string, unknown>
  payloadBytes: number
}

type MockNovelResourceOptions = {
  mutationDelayMs?: number
  onMutation?: (mutation: MockNovelResourceMutation) => void | Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRequestPayload(route: Route) {
  const body = route.request().postData() ?? '{}'
  const parsed = JSON.parse(body) as unknown
  if (!isRecord(parsed)) throw new Error('Novel resource mock received a non-object mutation payload')
  return { body, payload: parsed }
}

function buildLibraryPayload(workspace: MockNovelResourceWorkspace) {
  return {
    ok: true,
    novels: workspace.localNovels.map((novel) => {
      const chapters = workspace.localChapters
        .filter((chapter) => chapter.novelId === novel.id)
        .sort((left, right) => left.order - right.order)
      return {
        id: novel.id,
        title: novel.title,
        summary: novel.summary ?? '',
        tags: novel.tags ?? [],
        updatedAt: novel.updatedAt ?? chapters.at(-1)?.updatedAt ?? '',
        wordCount: novel.wordCount ?? chapters.reduce((total, chapter) => total + (chapter.wordCount ?? 0), 0),
        chapterCount: novel.chapterCount ?? chapters.length,
        firstChapterId: chapters[0]?.id ?? null,
      }
    }),
  }
}

function buildNovelPayload(workspace: MockNovelResourceWorkspace, novelId: string, revision: number) {
  const normalized = normalizeWorkspaceState(workspace as Partial<PersistedNovelState>)
  const novel = normalized.localNovels.find((item) => item.id === novelId)
  if (!novel) return null

  const {
    currentNovelId: _currentNovelId,
    currentChapterId: _currentChapterId,
    currentTab: _currentTab,
    helperTab: _helperTab,
    focusMode: _focusMode,
    selectionText: _selectionText,
    selectedParagraphIndex: _selectedParagraphIndex,
    aiSettings: _aiSettings,
    ...resource
  } = normalized

  return {
    ...resource,
    localNovels: [novel],
    localChapters: normalized.localChapters.filter((chapter) => chapter.novelId === novelId),
    workspaceRevision: revision,
    revisionNovelId: novelId,
  }
}

async function fulfillMutation(
  route: Route,
  mutation: Omit<MockNovelResourceMutation, 'payload' | 'payloadBytes'>,
  nextRevision: () => number,
  options: MockNovelResourceOptions,
) {
  const { body, payload } = parseRequestPayload(route)
  const revision = nextRevision()
  await options.onMutation?.({
    ...mutation,
    payload,
    payloadBytes: Buffer.byteLength(body),
  })
  if (options.mutationDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, options.mutationDelayMs))
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'X-Retale-Workspace-Revision': String(revision),
      'X-Retale-Revision-Novel-Id': mutation.novelId,
    },
    body: JSON.stringify({ ok: true, revision, novelId: mutation.novelId }),
  })
}

export async function mockNovelResourceApi(
  page: Page,
  readWorkspace: () => MockNovelResourceWorkspace,
  options: MockNovelResourceOptions = {},
) {
  let revision = 1
  const nextRevision = () => {
    revision += 1
    return revision
  }

  await page.route('**/api/novels**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const segments = url.pathname.split('/').filter(Boolean)
    const novelId = segments.length === 3 ? decodeURIComponent(segments[2] ?? '') : ''

    if (request.method() === 'GET' && !novelId) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildLibraryPayload(readWorkspace())) })
      return
    }

    if (request.method() === 'GET' && novelId) {
      const payload = buildNovelPayload(readWorkspace(), novelId, revision)
      await route.fulfill(payload
        ? {
            status: 200,
            contentType: 'application/json',
            headers: {
              'X-Retale-Workspace-Revision': String(revision),
              'X-Retale-Revision-Novel-Id': novelId,
            },
            body: JSON.stringify(payload),
          }
        : { status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Novel not found' }) })
      return
    }

    if (request.method() === 'POST' && novelId) {
      await fulfillMutation(route, { kind: 'novel', id: novelId, method: request.method(), novelId }, nextRevision, options)
      return
    }

    await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Method not allowed' }) })
  })

  await page.route('**/api/chapters/**', async (route) => {
    const request = route.request()
    const chapterId = decodeURIComponent(new URL(request.url()).pathname.split('/').filter(Boolean)[2] ?? '')
    const workspace = readWorkspace()
    const chapter = workspace.localChapters.find((item) => item.id === chapterId)
    if (request.method() !== 'PATCH' || !chapter) {
      await route.fulfill({ status: chapter ? 405 : 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: chapter ? 'Method not allowed' : 'Chapter not found' }) })
      return
    }

    await fulfillMutation(route, {
      kind: 'chapter',
      id: chapterId,
      method: request.method(),
      novelId: chapter.novelId,
    }, nextRevision, options)
  })
}
