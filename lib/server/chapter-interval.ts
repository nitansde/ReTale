export const INF_CHAPTER = 2147483647

export function isChapterActiveAt(validFromChapter: number | null | undefined, validUntilChapter: number, asOfChapter: number) {
  if (typeof validFromChapter !== 'number') return false
  if (validFromChapter > asOfChapter) return false
  return asOfChapter < validUntilChapter
}
