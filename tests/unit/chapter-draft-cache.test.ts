// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  canRestoreChapterDraftWithoutConflict,
  CHAPTER_DRAFT_CACHE_MAX_BYTES,
  CHAPTER_DRAFT_CACHE_MAX_ENTRY_COUNT,
  CHAPTER_DRAFT_CACHE_STORAGE_KEY,
  clearAcknowledgedChapterDrafts,
  createChapterContentFingerprint,
  readChapterDraft,
  writeChapterDraft,
} from '@/lib/chapter-draft-cache'

describe('chapter draft cache', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('preserves the original server baseline across repeated local writes', () => {
    const savedAt = Date.now()
    expect(writeChapterDraft({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContent: '<p>Server</p>',
      content: '<p>Draft one</p>',
      wordCount: 2,
      savedAt,
    })).toBe(true)
    expect(writeChapterDraft({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContent: '<p>Draft one</p>',
      content: '<p>Draft two</p>',
      wordCount: 2,
      savedAt: savedAt + 1,
    })).toBe(true)

    const draft = readChapterDraft('novel-1', 'chapter-1')
    expect(draft?.content).toBe('<p>Draft two</p>')
    expect(draft?.baseContentFingerprint).toBe(createChapterContentFingerprint('<p>Server</p>'))
    expect(draft && canRestoreChapterDraftWithoutConflict(draft, '<p>Server</p>')).toBe(true)
    expect(draft && canRestoreChapterDraftWithoutConflict(draft, '<p>Changed elsewhere</p>')).toBe(false)
  })

  it('removes a draft when the editor returns to its server baseline', () => {
    expect(writeChapterDraft({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContent: '<p>Server</p>',
      content: '<p>Draft</p>',
      wordCount: 1,
    })).toBe(true)
    expect(writeChapterDraft({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContent: '<p>Draft</p>',
      content: '<p>Server</p>',
      wordCount: 1,
    })).toBe(true)

    expect(readChapterDraft('novel-1', 'chapter-1')).toBeNull()
  })

  it('clears only drafts whose exact content was acknowledged', () => {
    writeChapterDraft({ novelId: 'novel-1', chapterId: 'chapter-1', baseContent: 'A', content: 'A1', wordCount: 1 })
    writeChapterDraft({ novelId: 'novel-1', chapterId: 'chapter-2', baseContent: 'B', content: 'B1', wordCount: 1 })

    expect(clearAcknowledgedChapterDrafts([
      { novelId: 'novel-1', id: 'chapter-1', content: 'A1' },
      { novelId: 'novel-1', id: 'chapter-2', content: 'newer than captured' },
    ])).toBe(true)
    expect(readChapterDraft('novel-1', 'chapter-1')).toBeNull()
    expect(readChapterDraft('novel-1', 'chapter-2')?.content).toBe('B1')
  })

  it('bounds entry count and rejects a draft that exceeds the aggregate byte budget', () => {
    const savedAt = Date.now()
    for (let index = 0; index < CHAPTER_DRAFT_CACHE_MAX_ENTRY_COUNT + 2; index += 1) {
      expect(writeChapterDraft({
        novelId: 'novel-1',
        chapterId: `chapter-${index}`,
        baseContent: `base-${index}`,
        content: `draft-${index}`,
        wordCount: 1,
        savedAt: savedAt + index,
      })).toBe(true)
    }

    const raw = JSON.parse(window.localStorage.getItem(CHAPTER_DRAFT_CACHE_STORAGE_KEY) ?? '{}') as { entries?: unknown[] }
    expect(raw.entries).toHaveLength(CHAPTER_DRAFT_CACHE_MAX_ENTRY_COUNT)
    expect(writeChapterDraft({
      novelId: 'novel-large',
      chapterId: 'chapter-large',
      baseContent: '',
      content: 'x'.repeat(CHAPTER_DRAFT_CACHE_MAX_BYTES),
      wordCount: 1,
    })).toBe(false)
    expect(readChapterDraft('novel-large', 'chapter-large')).toBeNull()
  })

  it('ignores malformed cache payloads', () => {
    window.localStorage.setItem(CHAPTER_DRAFT_CACHE_STORAGE_KEY, '{invalid')
    expect(readChapterDraft('novel-1', 'chapter-1')).toBeNull()
  })
})
