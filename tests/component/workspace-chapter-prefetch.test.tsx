// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceChapterPrefetch } from '@/components/workspace/use-workspace-chapter-prefetch'
import { useNovelStore } from '@/store/novel-store'

const prefetch = vi.fn<(signal: AbortSignal) => Promise<boolean>>()

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

describe('idle chapter prefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    prefetch.mockReset().mockResolvedValue(false)
    useNovelStore.setState({ ...useNovelStore.getInitialState(), prefetchChapterContent: prefetch }, true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    useNovelStore.setState(useNovelStore.getInitialState(), true)
  })

  it('waits for idle time, yields between batches, then stops when the novel is cached', async () => {
    prefetch.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    renderHook(useWorkspaceChapterPrefetch)
    await advance(1_999)
    expect(prefetch).not.toHaveBeenCalled()
    await advance(1)
    expect(prefetch).toHaveBeenCalledTimes(1)
    await advance(99)
    expect(prefetch).toHaveBeenCalledTimes(1)
    await advance(101)
    expect(prefetch).toHaveBeenCalledTimes(3)
    await advance(60_000)
    expect(prefetch).toHaveBeenCalledTimes(3)
  })

  it('waits for the browser idle callback and cancels it on input', async () => {
    let callback!: IdleRequestCallback
    const idle = vi.fn((next: IdleRequestCallback) => { callback = next; return 42 })
    const cancel = vi.fn()
    vi.stubGlobal('requestIdleCallback', idle)
    vi.stubGlobal('cancelIdleCallback', cancel)
    renderHook(useWorkspaceChapterPrefetch)
    await advance(2_000)
    expect(idle).toHaveBeenCalledTimes(1)
    expect(prefetch).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(new Event('keydown')))
    expect(cancel).toHaveBeenCalledWith(42)
    await advance(2_000)
    await act(async () => callback({ didTimeout: false, timeRemaining: () => 50 }))
    expect(prefetch).toHaveBeenCalledTimes(1)
  })

  it.each(['input', 'chapter', 'save', 'revision', 'hidden', 'offline', 'unmount'])(
    'aborts an active download on %s and yields to foreground work', async (event) => {
      prefetch.mockImplementation((signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(true), { once: true })
      }))
      const hook = renderHook(useWorkspaceChapterPrefetch)
      await advance(2_000)
      const signal = prefetch.mock.calls[0][0]
      act(() => {
        if (event === 'input') window.dispatchEvent(new Event('keydown'))
        if (event === 'chapter') useNovelStore.setState({ currentChapterId: 'another' })
        if (event === 'save') useNovelStore.setState({ isSaving: true })
        if (event === 'revision') useNovelStore.setState({ workspaceRevision: 8 })
        if (event === 'hidden') {
          vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
          document.dispatchEvent(new Event('visibilitychange'))
        }
        if (event === 'offline') {
          vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
          window.dispatchEvent(new Event('offline'))
        }
        if (event === 'unmount') hook.unmount()
      })
      expect(signal.aborted).toBe(true)
      await advance(1_999)
      expect(prefetch).toHaveBeenCalledTimes(1)
      if (['hidden', 'offline', 'unmount'].includes(event)) {
        await advance(60_000)
        expect(prefetch).toHaveBeenCalledTimes(1)
      } else {
        await advance(1)
        expect(prefetch).toHaveBeenCalledTimes(2)
      }
    },
  )

  it('backs off failures, caps retries, and resumes after reconnecting', async () => {
    prefetch.mockRejectedValue(new Error('Network unavailable'))
    renderHook(useWorkspaceChapterPrefetch)
    await advance(2_000)
    await advance(9_999)
    expect(prefetch).toHaveBeenCalledTimes(1)
    await advance(20_001)
    expect(prefetch).toHaveBeenCalledTimes(3)
    act(() => window.dispatchEvent(new Event('keydown')))
    await advance(60_000)
    expect(prefetch).toHaveBeenCalledTimes(3)
    prefetch.mockResolvedValue(false)
    act(() => window.dispatchEvent(new Event('online')))
    await advance(2_000)
    expect(prefetch).toHaveBeenCalledTimes(4)
  })
})
