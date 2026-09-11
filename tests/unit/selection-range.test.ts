import { describe, expect, it } from 'vitest'
import { findSelectionSpan, inferSelectionRange, splitContextLines } from '@/lib/selection-range'

describe('selection ranges', () => {
  it('locates later paragraphs past empty and whitespace-only lines', () => {
    const lines = splitContextLines('第一段。\n\n第二段。\n \t\n第三段。')
    expect(inferSelectionRange(lines, '第三段。')).toEqual({ lineStart: 5, lineEnd: 5 })
  })

  it.each(['\n', '\n\n'])('spans the full multiline selection with separator %j', (separator) => {
    const text = ['第一段。', '第二段。', '第三段。'].join(separator)
    expect(inferSelectionRange(splitContextLines(text), `第二段。${separator}第三段。`)).toEqual({
      lineStart: separator.length + 1, lineEnd: separator.length * 2 + 1,
    })
  })

  it('maps whitespace-normalized partial boundaries back to original offsets', () => {
    const text = '  First beginning\r\n\t middle\n\nending last  '
    const span = findSelectionSpan(text, 'beginning middle ending')
    expect(span).toEqual({ start: text.indexOf('beginning'), end: text.indexOf(' last') })
    expect(inferSelectionRange(splitContextLines(text), 'beginning middle ending')).toEqual({ lineStart: 1, lineEnd: 4 })
  })

  it('chooses one contiguous occurrence instead of spanning repeated fragments', () => {
    const lines = splitContextLines('repeat\nend\nunrelated\nrepeat\nend')
    expect(inferSelectionRange(lines, 'repeat\nend')).toEqual({ lineStart: 1, lineEnd: 2 })
    expect(inferSelectionRange(lines, 'repeat missing end')).toEqual({ lineStart: null, lineEnd: null })
  })

  it('does not let a short earlier line override a later full match', () => {
    expect(inferSelectionRange(splitContextLines('go\n\nThey go home.'), 'They go home.')).toEqual({ lineStart: 3, lineEnd: 3 })
  })

  it('preserves stored line numbering and UTF-16 offsets', () => {
    expect(inferSelectionRange([{ lineNo: 8, text: '👋 first' }, { lineNo: 12, text: 'last' }], 'first\nlast')).toEqual({ lineStart: 8, lineEnd: 12 })
    expect(findSelectionSpan('👋 first\t\tlast', 'first last')).toEqual({ start: 3, end: 14 })
  })

  it.each(['', ' \n\t', 'missing'])('returns no range for empty or unmatched selection %j', (selection) => {
    expect(inferSelectionRange(splitContextLines('first\n\nlast'), selection)).toEqual({ lineStart: null, lineEnd: null })
  })
})
