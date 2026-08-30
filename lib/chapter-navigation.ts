import type { ChapterTimelineItem } from '@/lib/story-branch-types'

export const CHAPTER_NAVIGATION_WINDOW_SIZE = 80
export const CHAPTER_NAVIGATION_SUMMARY_MAX_LENGTH = 96

function normalizeNavigationText(value: string | null | undefined) {
  return value?.replace(/\s+/gu, ' ').trim() ?? ''
}

function takeFirstSentence(value: string) {
  const match = value.match(/^(.{8,}?(?:[。！？!?]|\.(?=\s|$))[”’」』】）》）)]*)/u)
  return match?.[1]?.trim() || value
}

function truncateNavigationText(value: string, maxLength: number) {
  const characters = Array.from(value)
  if (characters.length <= maxLength) return value
  return `${characters.slice(0, Math.max(1, maxLength - 1)).join('').trimEnd()}…`
}

export function resolveChapterNavigationSummary(
  summary: string | null | undefined,
  rawText: string | null | undefined,
) {
  const source = normalizeNavigationText(summary) || normalizeNavigationText(rawText)
  if (!source) return null
  return truncateNavigationText(takeFirstSentence(source), CHAPTER_NAVIGATION_SUMMARY_MAX_LENGTH)
}

export function resolveCenteredChapterWindowStart<T extends { chapterId: string }>(
  chapters: T[],
  currentChapterId: string,
  windowSize = CHAPTER_NAVIGATION_WINDOW_SIZE,
) {
  if (!chapters.length || windowSize <= 0) return 0
  const currentIndex = chapters.findIndex((chapter) => chapter.chapterId === currentChapterId)
  if (currentIndex < 0) return 0
  const maxStart = Math.max(0, chapters.length - windowSize)
  return Math.min(maxStart, Math.max(0, currentIndex - Math.floor(windowSize / 2)))
}

export function filterChapterNavigationItems(
  chapters: ChapterTimelineItem[],
  query: string,
) {
  const normalizedQuery = normalizeNavigationText(query).toLocaleLowerCase()
  if (!normalizedQuery) return chapters

  const chapterNumberMatch = normalizedQuery.match(/^第?\s*(\d+)\s*章?$/u)
  if (chapterNumberMatch) {
    const chapterNo = Number(chapterNumberMatch[1])
    return chapters.filter((chapter) => chapter.chapterNo === chapterNo)
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  return chapters.filter((chapter) => {
    const haystack = [
      String(chapter.chapterNo),
      `第${chapter.chapterNo}章`,
      chapter.title,
      chapter.summary ?? '',
    ].join(' ').toLocaleLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}
