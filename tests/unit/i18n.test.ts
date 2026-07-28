import { describe, expect, it } from 'vitest'
import { enMessages, getMessage, zhMessages } from '@/lib/i18n/messages'

describe('i18n dictionaries', () => {
  it('keeps zh and en dictionaries in sync', () => {
    expect(Object.keys(enMessages).sort()).toEqual(Object.keys(zhMessages).sort())
  })

  it('formats translated messages with placeholders', () => {
    expect(getMessage('zh', 'library.importedAndOpening', { count: 3 })).toContain('3')
    expect(getMessage('en', 'library.title')).toBe('ReTale Library')
    expect(getMessage('en', 'chapterNav.showMore', { count: 8 })).toContain('8')
  })

  it('keeps canonical knowledge coverage grammar aligned across locales', () => {
    expect(getMessage('en', 'workspace.knowledge.status.coverage.all', { count: 12 })).toBe('All 12 chapters')
    expect(getMessage('en', 'workspace.knowledge.status.coverage.through', { chapter: 7 })).toBe('Through chapter 7')
    expect(getMessage('en', 'workspace.knowledge.status.coverage.range', { start: 4, end: 9 })).toBe('Chapters 4–9')
    expect(getMessage('en', 'workspace.knowledge.status.coverage.count', { covered: 5, total: 12 })).toBe('5 of 12 chapters')
    expect(getMessage('zh', 'workspace.knowledge.status.coverage.all', { count: 12 })).toBe('全部 12 章')
    expect(getMessage('zh', 'workspace.knowledge.status.coverage.through', { chapter: 7 })).toBe('至第 7 章')
    expect(getMessage('zh', 'workspace.knowledge.status.coverage.range', { start: 4, end: 9 })).toBe('第 4–9 章')
    expect(getMessage('zh', 'workspace.knowledge.status.coverage.count', { covered: 5, total: 12 })).toBe('5 / 12 章')
  })
})
