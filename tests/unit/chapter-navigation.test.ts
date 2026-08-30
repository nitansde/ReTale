import { describe, expect, it } from 'vitest'
import {
  filterChapterNavigationItems,
  resolveCenteredChapterWindowStart,
  resolveChapterNavigationSummary,
} from '@/lib/chapter-navigation'
import type { ChapterTimelineItem } from '@/lib/story-branch-types'

function chapter(chapterNo: number, summary = ''): ChapterTimelineItem {
  return {
    type: 'chapter',
    chapterId: `chapter-${chapterNo}`,
    chapterNo,
    title: `第${chapterNo}章`,
    wordCount: chapterNo * 10,
    summary,
  }
}

describe('chapter navigation helpers', () => {
  it('reuses the complete stored chapter summary without truncating it', () => {
    expect(resolveChapterNavigationSummary(
      '女主在雨夜发现密室。随后她决定独自追查，并在旧相框背面发现新的线索。',
    )).toBe('女主在雨夜发现密室。随后她决定独自追查，并在旧相框背面发现新的线索。')
  })

  it('does not derive a navigation summary from chapter body text', () => {
    expect(resolveChapterNavigationSummary(null)).toBeNull()
    expect(resolveChapterNavigationSummary('   ')).toBeNull()
  })

  it('centers a bounded window on the current chapter in a long novel', () => {
    const chapters = Array.from({ length: 200 }, (_, index) => chapter(index + 1))
    const start = resolveCenteredChapterWindowStart(chapters, 'chapter-150', 80)

    expect(start).toBe(109)
    expect(chapters.slice(start, start + 80)[40]?.chapterId).toBe('chapter-150')
  })

  it('supports exact chapter-number jumps and plot-keyword search', () => {
    const chapters = [
      chapter(8, '众人在港口会合。'),
      chapter(88, '女主发现密室中的旧照片。'),
      chapter(188, '密室真相终于公开。'),
    ]

    expect(filterChapterNavigationItems(chapters, '第 88 章').map((item) => item.chapterNo)).toEqual([88])
    expect(filterChapterNavigationItems(chapters, '密室').map((item) => item.chapterNo)).toEqual([88, 188])
  })
})
