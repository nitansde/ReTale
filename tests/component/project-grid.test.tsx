// @vitest-environment jsdom

import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectGrid, resolveOpenNovelChapter } from '@/components/library/project-grid'

const pushMock = vi.fn()

type MockChapter = {
  id: string
  novelId: string | null
  parentChapterId?: string | null
  order: number
}

type MockStoreState = {
  backendLoadError: string
  backendLoaded: boolean
  localChapters: MockChapter[]
  getNovels: () => Array<{ id: string; title: string; summary: string; tags: string[] }>
  loadFromBackend: () => Promise<void>
  saveToBackend: () => Promise<void>
  setCurrentNovelId: (novelId: string) => void
  setCurrentChapterId: (chapterId: string) => void
  deleteNovel: (novelId: string) => void
}

let mockStoreState: MockStoreState

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

vi.mock('@/components/library/project-card', () => ({
  ProjectCard: ({ novel, onOpen, onDelete, opening, deleting }: {
    novel: { id: string; title: string }
    onOpen: () => void
    onDelete: () => void
    opening?: boolean
    deleting?: boolean
  }) => (
    <div data-testid={`project-card-${novel.id}`} data-opening={opening ? 'true' : 'false'} data-deleting={deleting ? 'true' : 'false'}>
      <button type="button" onClick={onOpen} disabled={opening} aria-busy={opening}>
        {opening ? '打开中…' : 'Open project'}
      </button>
      <button type="button" onClick={onDelete} disabled={opening || deleting}>
        Delete project
      </button>
    </div>
  ),
}))

vi.mock('@/store/novel-store', () => {
  const useNovelStore = () => mockStoreState
  useNovelStore.getState = () => mockStoreState
  return { useNovelStore }
})

class MockXMLHttpRequest {
  static responseBody: unknown = null
  static status = 200

  upload: {
    onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null
    onload: (() => void) | null
  } = {
    onprogress: null,
    onload: null,
  }

  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = MockXMLHttpRequest.status
  responseText = ''

  open() {}

  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 })
    this.upload.onload?.()
    this.status = MockXMLHttpRequest.status
    this.responseText = JSON.stringify(MockXMLHttpRequest.responseBody)
    this.onload?.()
  }
}

function renderProjectGrid() {
  return render(<ProjectGrid />)
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function importTxt(container: HTMLElement, fileName = 'fixture.txt') {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
  expect(input).not.toBeNull()
  const file = new File(['fixture'], fileName, { type: 'text/plain' })
  await act(async () => {
    fireEvent.change(input!, { target: { files: [file] } })
    await Promise.resolve()
  })
}

describe('ProjectGrid chapter resolution', () => {
  beforeEach(() => {
    pushMock.mockReset()
    MockXMLHttpRequest.responseBody = null
    MockXMLHttpRequest.status = 200
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers the freshly loaded chapter id after import reload', () => {
    const chapter = resolveOpenNovelChapter([
      {
        id: 'ch-new-1',
        novelId: 'novel-new',
        parentChapterId: null,
        order: 1,
      },
    ], 'novel-new', 'ch-new-1')

    expect(chapter).toEqual({
      id: 'ch-new-1',
      novelId: 'novel-new',
      parentChapterId: null,
      order: 1,
    })
  })

  it('falls back to the first top-level chapter for existing novels', () => {
    const chapter = resolveOpenNovelChapter([
      {
        id: 'branch-1',
        novelId: 'novel-a',
        parentChapterId: 'ch-1',
        order: 1.1,
      },
      {
        id: 'ch-2',
        novelId: 'novel-a',
        parentChapterId: null,
        order: 2,
      },
      {
        id: 'ch-1',
        novelId: 'novel-a',
        parentChapterId: null,
        order: 1,
      },
    ], 'novel-a')

    expect(chapter?.id).toBe('ch-1')
  })

  it('opens the imported novel from refreshed store state even if the render snapshot was stale', async () => {
    const setCurrentNovelId = vi.fn()
    const setCurrentChapterId = vi.fn()
    const saveToBackend = vi.fn(async () => undefined)
    const loadFromBackend = vi.fn(async () => {
      mockStoreState = {
        ...mockStoreState,
        localChapters: [{ id: 'ch-new-1', novelId: 'novel-new', parentChapterId: null, order: 1 }],
      }
    })

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [],
      getNovels: () => [],
      loadFromBackend,
      saveToBackend,
      setCurrentNovelId,
      setCurrentChapterId,
      deleteNovel: vi.fn(),
    }

    MockXMLHttpRequest.responseBody = {
      novelId: 'novel-new',
      chapterId: 'ch-new-1',
      chapterCount: 11,
    }

    const { container } = renderProjectGrid()
    await importTxt(container)

    await waitFor(() => {
      expect(loadFromBackend).toHaveBeenCalledTimes(1)
      expect(saveToBackend).toHaveBeenCalledTimes(1)
      expect(setCurrentNovelId).toHaveBeenCalledWith('novel-new')
      expect(setCurrentChapterId).toHaveBeenCalledWith('ch-new-1')
      expect(pushMock).toHaveBeenCalledWith('/workspace')
    })

    expect(screen.queryByText('这个小说当前没有可用章节，请刷新后重试，或重新导入一次。')).not.toBeInTheDocument()
  })

  it('shows the warning when the refreshed store still has no imported chapter', async () => {
    const setCurrentNovelId = vi.fn()
    const setCurrentChapterId = vi.fn()
    const loadFromBackend = vi.fn(async () => {
      mockStoreState = {
        ...mockStoreState,
        localChapters: [],
      }
    })

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [],
      getNovels: () => [],
      loadFromBackend,
      saveToBackend: vi.fn(async () => undefined),
      setCurrentNovelId,
      setCurrentChapterId,
      deleteNovel: vi.fn(),
    }

    MockXMLHttpRequest.responseBody = {
      novelId: 'novel-new',
      chapterId: 'missing-chapter',
      chapterCount: 11,
    }

    const { container } = renderProjectGrid()
    await importTxt(container)

    await waitFor(() => {
      expect(screen.getByText('这个小说当前没有可用章节，请刷新后重试，或重新导入一次。')).toBeInTheDocument()
    })

    expect(setCurrentNovelId).not.toHaveBeenCalled()
    expect(setCurrentChapterId).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('shows a lightweight loading message while recovering the library from backend state', () => {
    mockStoreState = {
      backendLoadError: '',
      backendLoaded: false,
      localChapters: [],
      getNovels: () => [],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend: vi.fn(async () => undefined),
      setCurrentNovelId: vi.fn(),
      setCurrentChapterId: vi.fn(),
      deleteNovel: vi.fn(),
    }

    renderProjectGrid()

    expect(screen.getByText('正在恢复书库与上次工作区…如果本地数据较大，可能需要几秒钟。')).toBeInTheDocument()
  })

  it('navigates immediately after selecting the novel and chapter, then persists in the background', async () => {
    const callOrder: string[] = []
    const setCurrentNovelId = vi.fn((novelId: string) => {
      callOrder.push(`novel:${novelId}`)
    })
    const setCurrentChapterId = vi.fn((chapterId: string) => {
      callOrder.push(`chapter:${chapterId}`)
    })
    const saveToBackend = vi.fn(async () => {
      callOrder.push('save')
    })

    pushMock.mockImplementation(() => {
      callOrder.push('push')
    })

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-1', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend,
      setCurrentNovelId,
      setCurrentChapterId,
      deleteNovel: vi.fn(),
    }

    renderProjectGrid()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
      await Promise.resolve()
    })

    expect(pushMock).toHaveBeenCalledWith('/workspace')
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['novel:novel-a', 'chapter:ch-1', 'push', 'save'])
  })

  it('keeps the existing in-memory selection and only warns when background persistence fails', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setCurrentNovelId = vi.fn()
    const setCurrentChapterId = vi.fn()
    const saveToBackend = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('stale state'))

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-stale', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend,
      setCurrentNovelId,
      setCurrentChapterId,
      deleteNovel: vi.fn(),
    }

    renderProjectGrid()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/workspace')
    })

    expect(setCurrentNovelId).toHaveBeenNthCalledWith(1, 'novel-a')
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    expect(setCurrentChapterId).toHaveBeenCalledTimes(1)
    expect(setCurrentChapterId).toHaveBeenCalledWith('ch-stale')
    expect(screen.queryByText('进入工作区失败，请稍后重试。')).not.toBeInTheDocument()
    expect(consoleWarn).toHaveBeenCalled()
  })

  it('does not reload or retry save after the handoff begins', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setCurrentNovelId = vi.fn()
    const setCurrentChapterId = vi.fn()
    const loadFromBackend = vi.fn(async () => undefined)
    const saveToBackend = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('still failing'))

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-stale', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend,
      saveToBackend,
      setCurrentNovelId,
      setCurrentChapterId,
      deleteNovel: vi.fn(),
    }

    renderProjectGrid()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/workspace')
    })

    expect(loadFromBackend).not.toHaveBeenCalled()
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    expect(setCurrentChapterId).toHaveBeenCalledTimes(1)
    expect(setCurrentChapterId).toHaveBeenCalledWith('ch-stale')
    expect(screen.queryByText('进入工作区失败，请稍后重试。')).not.toBeInTheDocument()
    expect(consoleWarn).toHaveBeenCalled()
  })

  it('shows per-card opening feedback while navigation has already started and save is still pending', async () => {
    const saveDeferred = createDeferredPromise<void>()
    const saveToBackend = vi.fn(() => saveDeferred.promise)

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-1', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend,
      setCurrentNovelId: vi.fn(),
      setCurrentChapterId: vi.fn(),
      deleteNovel: vi.fn(),
    }

    renderProjectGrid()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: '打开中…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeDisabled()
    expect(screen.getByTestId('project-card-novel-a')).toHaveAttribute('data-opening', 'true')
    expect(pushMock).toHaveBeenCalledWith('/workspace')

    await act(async () => {
      saveDeferred.resolve()
      await saveDeferred.promise
    })

    expect(pushMock).toHaveBeenCalledTimes(1)
  })
})
