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
  deleteNovelFromBackend: (novelId: string) => Promise<
    | { status: 'committed'; result: { ok: true; deletedNovelId: string; activeNovelId: string | null; deletionState: 'deleted'; cleanupPending: boolean } }
    | { status: 'rejected'; error: string }
    | { status: 'indeterminate'; error: string }
  >
  reconcileNovelDeletionFromBackend?: (transaction: { novelId: string; before: object; optimistic: object }) => Promise<'deleted' | 'present'>
  isNovelDeletionPending?: boolean
  beginNovelDeletion?: (novelId: string) => { novelId: string; before: object; optimistic: object } | null
  rollbackNovelDeletion?: (transaction: { novelId: string; before: object; optimistic: object }) => void
  setNovelDeletionPending?: (pending: boolean) => void
  reconcileNovelDeletion?: (activeNovelId: string | null) => void
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
  static autoRespond = true
  static instances: MockXMLHttpRequest[] = []

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

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  open() {}

  send() {
    if (!MockXMLHttpRequest.autoRespond) return
    this.emitUploadProgress(1, 1)
    this.finishUpload()
    this.respond(MockXMLHttpRequest.responseBody, MockXMLHttpRequest.status)
  }

  emitUploadProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
  }

  finishUpload() {
    this.upload.onload?.()
  }

  respond(body: unknown, status = 200) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }

  failNetwork() {
    this.onerror?.()
  }
}

function renderProjectGrid() {
  mockStoreState = {
    isNovelDeletionPending: false,
    beginNovelDeletion: (novelId) => ({ novelId, before: {}, optimistic: {} }),
    rollbackNovelDeletion: vi.fn(),
    reconcileNovelDeletionFromBackend: vi.fn(async () => 'deleted' as const),
    setNovelDeletionPending: vi.fn(),
    reconcileNovelDeletion: vi.fn(),
    ...mockStoreState,
  }
  return render(<ProjectGrid />)
}

function deletedNovelResult(novelId: string, activeNovelId: string | null = null, cleanupPending = false) {
  return {
    status: 'committed' as const,
    result: { ok: true as const, deletedNovelId: novelId, activeNovelId, deletionState: 'deleted' as const, cleanupPending },
  }
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

function setReadyStore(overrides: Partial<MockStoreState> = {}) {
  mockStoreState = {
    backendLoadError: '',
    backendLoaded: true,
    localChapters: [],
    getNovels: () => [],
    loadFromBackend: vi.fn(async () => undefined),
    saveToBackend: vi.fn(async () => undefined),
    deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
    setCurrentNovelId: vi.fn(),
    setCurrentChapterId: vi.fn(),
    deleteNovel: vi.fn(),
    ...overrides,
  }
}

describe('ProjectGrid chapter resolution', () => {
  beforeEach(() => {
    pushMock.mockReset()
    MockXMLHttpRequest.responseBody = null
    MockXMLHttpRequest.status = 200
    MockXMLHttpRequest.autoRespond = true
    MockXMLHttpRequest.instances = []
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
      deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
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
      deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
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

  it('shows real partial transport progress while the upload is active', async () => {
    setReadyStore()
    MockXMLHttpRequest.autoRespond = false

    const { container } = renderProjectGrid()
    await importTxt(container, 'partial.txt')

    const xhr = MockXMLHttpRequest.instances[0]
    await act(async () => {
      xhr.emitUploadProgress(2, 5)
      await Promise.resolve()
    })

    expect(screen.getByRole('progressbar', { name: '上传进度' })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText('正在上传 partial.txt … 40%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上传中…' })).toBeDisabled()
  })

  it('switches to indeterminate processing after upload completion and waits for the response', async () => {
    setReadyStore()
    MockXMLHttpRequest.autoRespond = false

    const { container } = renderProjectGrid()
    await importTxt(container, 'processing.txt')

    const xhr = MockXMLHttpRequest.instances[0]
    await act(async () => {
      xhr.emitUploadProgress(1, 1)
      xhr.finishUpload()
      await Promise.resolve()
    })

    expect(screen.getByText('服务器处理')).toBeInTheDocument()
    expect(screen.getByText('文件上传完成，服务器正在解析并入库 processing.txt …')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('完成')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解析中…' })).toBeDisabled()
  })

  it('keeps processing visible until the backend refresh resolves', async () => {
    const refreshDeferred = createDeferredPromise<void>()
    const loadFromBackend = vi.fn(() => refreshDeferred.promise)
    setReadyStore({ loadFromBackend })
    MockXMLHttpRequest.autoRespond = false

    const { container } = renderProjectGrid()
    await importTxt(container, 'refresh.txt')

    const xhr = MockXMLHttpRequest.instances[0]
    await act(async () => {
      xhr.finishUpload()
      xhr.respond({ novelId: 'novel-new', chapterId: 'ch-new', chapterCount: 121 })
      await Promise.resolve()
    })

    expect(loadFromBackend).toHaveBeenCalledTimes(1)
    expect(screen.getByText('服务器处理')).toBeInTheDocument()
    expect(screen.queryByText(/服务器已解析完成/)).not.toBeInTheDocument()

    await act(async () => {
      refreshDeferred.resolve()
      await refreshDeferred.promise
    })

    expect(await screen.findByText('上传完成，服务器已解析完成：共 121 章。已刷新书库，请从书库卡片进入工作区。')).toBeInTheDocument()
  })

  it('shows terminal success only after the response and refresh complete', async () => {
    setReadyStore()
    MockXMLHttpRequest.autoRespond = false

    const { container } = renderProjectGrid()
    await importTxt(container, 'success.txt')

    const xhr = MockXMLHttpRequest.instances[0]
    await act(async () => {
      xhr.finishUpload()
      xhr.respond({ novelId: 'novel-new', chapterId: 'ch-new', chapterCount: 121 })
      await Promise.resolve()
    })

    expect(await screen.findByText('上传完成，服务器已解析完成：共 121 章。已刷新书库，请从书库卡片进入工作区。')).toBeInTheDocument()
    expect(screen.getByText('导入结果')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入 TXT 小说' })).toBeEnabled()
  })

  it.each([
    ['missing novel id', { chapterId: 'ch-new', chapterCount: 1 }],
    ['blank novel id', { novelId: '   ', chapterId: 'ch-new', chapterCount: 1 }],
    ['blank chapter id', { novelId: 'novel-new', chapterId: '', chapterCount: 1 }],
    ['negative chapter count', { novelId: 'novel-new', chapterId: 'ch-new', chapterCount: -1 }],
    ['fractional chapter count', { novelId: 'novel-new', chapterId: 'ch-new', chapterCount: 1.5 }],
    ['non-numeric chapter count', { novelId: 'novel-new', chapterId: 'ch-new', chapterCount: '1' }],
  ])('rejects malformed successful import payloads with %s before refresh or navigation', async (_label, payload) => {
    const loadFromBackend = vi.fn(async () => undefined)
    setReadyStore({ loadFromBackend })
    MockXMLHttpRequest.autoRespond = false
  
    const { container } = renderProjectGrid()
    await importTxt(container, 'malformed-success.txt')
  
    await act(async () => {
      MockXMLHttpRequest.instances[0].respond(payload)
      await Promise.resolve()
    })
  
    expect(screen.getByRole('alert')).toHaveTextContent('服务器返回了无效结果')
    expect(loadFromBackend).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
  
  it('ignores import callbacks after unmount', async () => {
    const loadFromBackend = vi.fn(async () => undefined)
    setReadyStore({ loadFromBackend })
    MockXMLHttpRequest.autoRespond = false
  
    const { container, unmount } = renderProjectGrid()
    await importTxt(container, 'unmounted.txt')
    const xhr = MockXMLHttpRequest.instances[0]
    unmount()
  
    await act(async () => {
      xhr.respond({ novelId: 'novel-new', chapterId: 'ch-new', chapterCount: 1 })
      await Promise.resolve()
    })
  
    expect(loadFromBackend).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
  
  it('shows a localized alert for a server failure without exposing raw diagnostics', async () => { setReadyStore()
  MockXMLHttpRequest.autoRespond = false
  
  const { container } = renderProjectGrid()
  await importTxt(container, 'server-error.txt')
  
  const xhr = MockXMLHttpRequest.instances[0]
  await act(async () => {
    xhr.finishUpload()
    xhr.respond({ error: 'SQLITE_CONSTRAINT: internal path /private/data/control.db' }, 500)
    await Promise.resolve()
  })
  
  expect(screen.getByRole('alert')).toHaveTextContent('导入失败')
  expect(screen.queryByText(/SQLITE_CONSTRAINT|private\/data\/control\.db/)).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument() })

  it('shows a localized alert for a network failure', async () => {
    setReadyStore()
    MockXMLHttpRequest.autoRespond = false

    const { container } = renderProjectGrid()
    await importTxt(container, 'network-error.txt')

    const xhr = MockXMLHttpRequest.instances[0]
    await act(async () => {
      xhr.failNetwork()
      await Promise.resolve()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('上传失败，请检查本地服务是否正常')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('clears prior terminal feedback when retrying an import', async () => {
    setReadyStore()
    MockXMLHttpRequest.autoRespond = false

    const { container } = renderProjectGrid()
    await importTxt(container, 'failed.txt')

    await act(async () => {
      MockXMLHttpRequest.instances[0].respond({ error: 'raw failure' }, 500)
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('导入失败')

    await importTxt(container, 'retry.txt')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('正在上传 retry.txt … 0%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '上传进度' })).toHaveAttribute('aria-valuenow', '0')
  })

  it('shows a lightweight loading message while recovering the library from backend state', () => {
    mockStoreState = {
      backendLoadError: '',
      backendLoaded: false,
      localChapters: [],
      getNovels: () => [],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend: vi.fn(async () => undefined),
      deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
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
      deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
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
      deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
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
      deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
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
      deleteNovelFromBackend: vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
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

  it('accepts a cleanup-pending success and reconciles the authoritative survivor', async () => {
    const deleteDeferred = createDeferredPromise<ReturnType<typeof deletedNovelResult>>()
    const deleteNovelFromBackend = vi.fn(() => deleteDeferred.promise)
    const transaction = { novelId: 'novel-a', before: {}, optimistic: {} }
    const beginNovelDeletion = vi.fn(() => transaction)
    const setNovelDeletionPending = vi.fn()
    const reconcileNovelDeletion = vi.fn()

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-1', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend: vi.fn(async () => undefined),
      deleteNovelFromBackend,
      setCurrentNovelId: vi.fn(),
      setCurrentChapterId: vi.fn(),
      deleteNovel: vi.fn(),
      beginNovelDeletion,
      rollbackNovelDeletion: vi.fn(),
      setNovelDeletionPending,
      reconcileNovelDeletion,
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderProjectGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    expect(beginNovelDeletion).toHaveBeenCalledWith('novel-a')
    expect(deleteNovelFromBackend).toHaveBeenCalledWith('novel-a')
    expect(setNovelDeletionPending).toHaveBeenNthCalledWith(1, true)
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeDisabled()
    expect(screen.queryByText('已删除《Novel A》')).not.toBeInTheDocument()

    await act(async () => {
      deleteDeferred.resolve(deletedNovelResult('novel-a', 'novel-survivor', true))
      await deleteDeferred.promise
    })

    expect(reconcileNovelDeletion).toHaveBeenCalledWith('novel-survivor')
    expect(setNovelDeletionPending).toHaveBeenLastCalledWith(false)
    expect(screen.getByText('已删除《Novel A》')).toBeInTheDocument()
  })

  it('uses targeted rollback without reloading when deletion is definitively rejected', async () => {
    const loadFromBackend = vi.fn(async () => undefined)
    const deleteNovel = vi.fn()
    const deleteNovelFromBackend = vi.fn(async () => ({ status: 'rejected' as const, error: 'delete conflict' }))
    const transaction = { novelId: 'novel-a', before: {}, optimistic: {} }
    const rollbackNovelDeletion = vi.fn()
    const setNovelDeletionPending = vi.fn()

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-1', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend,
      saveToBackend: vi.fn(async () => undefined),
      deleteNovelFromBackend,
      setCurrentNovelId: vi.fn(),
      setCurrentChapterId: vi.fn(),
      deleteNovel,
      beginNovelDeletion: vi.fn(() => transaction),
      rollbackNovelDeletion,
      setNovelDeletionPending,
      reconcileNovelDeletion: vi.fn(),
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderProjectGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    await waitFor(() => {
      expect(screen.getByText('删除《Novel A》失败，已恢复本地状态。')).toBeInTheDocument()
    })
    expect(deleteNovel).not.toHaveBeenCalled()
    expect(rollbackNovelDeletion).toHaveBeenCalledTimes(1)
    expect(rollbackNovelDeletion).toHaveBeenCalledWith(transaction)
    expect(loadFromBackend).not.toHaveBeenCalled()
    expect(setNovelDeletionPending.mock.calls).toEqual([[true], [false]])
  })

  it.each([
    { targetPresent: false, expectedMessage: '已删除《Novel A》' },
    { targetPresent: true, expectedMessage: '服务器确认《Novel A》未被删除，已恢复权威状态。' },
  ])('reconciles an indeterminate result with target present=$targetPresent before clearing pending', async ({ targetPresent, expectedMessage }) => {
    const reconcileDeferred = createDeferredPromise<'deleted' | 'present'>()
    const setNovelDeletionPending = vi.fn()
    const transaction = { novelId: 'novel-a', before: {}, optimistic: {} }
    const reconcileNovelDeletionFromBackend = vi.fn(() => reconcileDeferred.promise)

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-1', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend: vi.fn(async () => undefined),
      deleteNovelFromBackend: vi.fn(async () => ({ status: 'indeterminate' as const, error: 'response lost' })),
      reconcileNovelDeletionFromBackend,
      setCurrentNovelId: vi.fn(),
      setCurrentChapterId: vi.fn(),
      deleteNovel: vi.fn(),
      beginNovelDeletion: vi.fn(() => transaction),
      rollbackNovelDeletion: vi.fn(),
      setNovelDeletionPending,
      reconcileNovelDeletion: vi.fn(),
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderProjectGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    await waitFor(() => expect(reconcileNovelDeletionFromBackend).toHaveBeenCalledWith(transaction))
    expect(setNovelDeletionPending).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeDisabled()

    await act(async () => {
      reconcileDeferred.resolve(targetPresent ? 'present' : 'deleted')
      await reconcileDeferred.promise
    })

    expect(screen.getByText(expectedMessage)).toBeInTheDocument()
    expect(setNovelDeletionPending.mock.calls).toEqual([[true], [false]])
  })

  it('keeps the optimistic state and reports reconciliation failure for an indeterminate result', async () => {
    const rollbackNovelDeletion = vi.fn()
    const setNovelDeletionPending = vi.fn()

    mockStoreState = {
      backendLoadError: '',
      backendLoaded: true,
      localChapters: [{ id: 'ch-1', novelId: 'novel-a', parentChapterId: null, order: 1 }],
      getNovels: () => [{ id: 'novel-a', title: 'Novel A', summary: 'Summary', tags: [] }],
      loadFromBackend: vi.fn(async () => undefined),
      saveToBackend: vi.fn(async () => undefined),
      deleteNovelFromBackend: vi.fn(async () => ({ status: 'indeterminate' as const, error: 'malformed response' })),
      reconcileNovelDeletionFromBackend: vi.fn().mockRejectedValue(new Error('workspace unavailable')),
      setCurrentNovelId: vi.fn(),
      setCurrentChapterId: vi.fn(),
      deleteNovel: vi.fn(),
      beginNovelDeletion: vi.fn((novelId) => ({ novelId, before: {}, optimistic: {} })),
      rollbackNovelDeletion,
      setNovelDeletionPending,
      reconcileNovelDeletion: vi.fn(),
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderProjectGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    await waitFor(() => {
      expect(screen.getByText('无法确认《Novel A》是否已删除，请刷新书库后重试。')).toBeInTheDocument()
    })
    expect(rollbackNovelDeletion).not.toHaveBeenCalled()
    expect(setNovelDeletionPending.mock.calls).toEqual([[true], [false]])
  })
})
