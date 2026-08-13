import { beforeEach, describe, expect, it } from 'vitest'
import { useNovelStore } from '@/store/novel-store'
import {
  AUTOSAVE_PERFORMANCE_CHAPTER_ID,
  buildTenThousandCharacterEditBurst,
  buildThousandChapterWorkspace,
} from '@/tests/helpers/autosave-performance-fixtures'

describe('targeted chapter updates', () => {
  beforeEach(() => {
    useNovelStore.getState().restorePersistedState(buildThousandChapterWorkspace())
    useNovelStore.setState({ persistRevision: 0 })
  })

  it('replaces only the targeted item in a 1,000-chapter workspace using the precomputed word count', () => {
    const before = useNovelStore.getState().localChapters
    const targetIndex = before.findIndex((chapter) => chapter.id === AUTOSAVE_PERFORMANCE_CHAPTER_ID)
    const unaffectedIndex = targetIndex + 1
    const html = '<p>Targeted replacement</p>'

    useNovelStore.getState().updateChapterContent(AUTOSAVE_PERFORMANCE_CHAPTER_ID, html, 17)

    const after = useNovelStore.getState().localChapters
    expect(after).not.toBe(before)
    expect(after[targetIndex]).not.toBe(before[targetIndex])
    expect(after[unaffectedIndex]).toBe(before[unaffectedIndex])
    expect(after[targetIndex]).toEqual(expect.objectContaining({ content: html, wordCount: 17 }))
    expect(useNovelStore.getState().persistRevision).toBe(1)
  })

  it('coalesces a 10,000-character burst into one store commit when flushed once', () => {
    const burst = buildTenThousandCharacterEditBurst()
    const beforeRevision = useNovelStore.getState().persistRevision

    useNovelStore.getState().updateChapterContent(AUTOSAVE_PERFORMANCE_CHAPTER_ID, `<p>${burst}</p>`, burst.length)

    expect(useNovelStore.getState().persistRevision - beforeRevision).toBe(1)
    expect(useNovelStore.getState().localChapters[0].content).toBe(`<p>${burst}</p>`)
  })
})
