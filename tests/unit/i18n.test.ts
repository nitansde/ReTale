import { describe, expect, it } from 'vitest'
import { enMessages, getMessage, localizeUpdatedAt, zhMessages } from '@/lib/i18n/messages'

describe('i18n dictionaries', () => {
  it('keeps zh and en dictionaries in sync', () => {
    expect(Object.keys(enMessages).sort()).toEqual(Object.keys(zhMessages).sort())
  })

  it('formats translated messages with placeholders', () => {
    expect(getMessage('zh', 'library.importedAndOpening', { count: 3 })).toContain('3')
    expect(getMessage('en', 'library.title')).toBe('ReTale Library')
    expect(getMessage('en', 'chapterNav.chapterCount', { count: 8 })).toContain('8')
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

  it('shows a stored updated-at label in the current language', () => {
    expect(localizeUpdatedAt('14:14 · Edited', 'zh')).toBe('14:14 · 已编辑')
    expect(localizeUpdatedAt('14:14 · 已编辑', 'en')).toBe('14:14 · Edited')
    expect(localizeUpdatedAt('14:14 · 已编辑', 'zh')).toBe('14:14 · 已编辑')
  })

  it('drops the permanent "just now" from labels on older imports', () => {
    expect(localizeUpdatedAt('刚刚 · 导入', 'zh')).toBe('导入')
    expect(localizeUpdatedAt('刚刚 · 导入', 'en')).toBe('Imported')
  })

  it('leaves labels without a known suffix unchanged', () => {
    expect(localizeUpdatedAt('14:14', 'en')).toBe('14:14')
  })
})
