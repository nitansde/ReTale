import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChapterEditorBuffer } from '@/components/workspace/chapter-editor-buffer'

describe('chapter editor buffer', () => {
  beforeEach(() => vi.useFakeTimers())

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('coalesces updates and reads HTML/plain text exactly once at flush', () => {
    const commit = vi.fn()
    const readA = vi.fn(() => ({ html: '<p>A</p>', plainText: 'A' }))
    const readLatest = vi.fn(() => ({ html: '<p>Latest</p>', plainText: 'Latest' }))
    const buffer = createChapterEditorBuffer({ delayMs: 300, commit })

    buffer.update('chapter-a', readA)
    buffer.update('chapter-a', readLatest)

    expect(readA).not.toHaveBeenCalled()
    expect(readLatest).not.toHaveBeenCalled()
    vi.advanceTimersByTime(299)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(readA).not.toHaveBeenCalled()
    expect(readLatest).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ chapterId: 'chapter-a', html: '<p>Latest</p>', plainText: 'Latest' })
  })

  it('flushes the owned chapter synchronously and makes stale timers inert', () => {
    const commit = vi.fn()
    const buffer = createChapterEditorBuffer({ delayMs: 300, commit })
    buffer.update('chapter-a', () => ({ html: '<p>A</p>', plainText: 'A' }))

    expect(buffer.flush()).toEqual({ chapterId: 'chapter-a', html: '<p>A</p>', plainText: 'A' })
    buffer.update('chapter-b', () => ({ html: '<p>B</p>', plainText: 'B' }))
    vi.advanceTimersByTime(300)
    vi.advanceTimersByTime(10_000)

    expect(commit.mock.calls.map(([payload]) => payload.chapterId)).toEqual(['chapter-a', 'chapter-b'])
  })

  it('supports rapid A to B to A ownership without cross-chapter writes', () => {
    const commit = vi.fn()
    const buffer = createChapterEditorBuffer({ delayMs: 300, commit })

    buffer.update('chapter-a', () => ({ html: '<p>A1</p>', plainText: 'A1' }))
    buffer.flush()
    buffer.update('chapter-b', () => ({ html: '<p>B1</p>', plainText: 'B1' }))
    buffer.flush()
    buffer.update('chapter-a', () => ({ html: '<p>A2</p>', plainText: 'A2' }))
    vi.advanceTimersByTime(300)

    expect(commit.mock.calls.map(([payload]) => payload)).toEqual([
      { chapterId: 'chapter-a', html: '<p>A1</p>', plainText: 'A1' },
      { chapterId: 'chapter-b', html: '<p>B1</p>', plainText: 'B1' },
      { chapterId: 'chapter-a', html: '<p>A2</p>', plainText: 'A2' },
    ])
  })

  it('discards externally replaced content without committing it', () => {
    const commit = vi.fn()
    const read = vi.fn(() => ({ html: '<p>External</p>', plainText: 'External' }))
    const buffer = createChapterEditorBuffer({ delayMs: 300, commit })

    buffer.update('chapter-a', read)
    buffer.discard()
    vi.advanceTimersByTime(10_000)

    expect(read).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
})
