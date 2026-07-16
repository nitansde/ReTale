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
})
