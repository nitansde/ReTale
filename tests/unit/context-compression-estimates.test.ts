import { describe, expect, it } from 'vitest'
import { estimateCompressionSavings, estimateSavedCompressionTokens, type ContextCompressionPreview } from '@/lib/context-compression'

const preview: ContextCompressionPreview = {
  scope: { novelId: 'novel', branchId: 'main' }, fingerprint: 'history',
  totalChapters: 4, compressedChapters: 0, summary: null, tokenEstimate: 200000,
  chapters: [40000, 50000, 60000, 50000].map((tokenEstimate, i) => ({ label: `Chapter ${i + 1}`, tokenEstimate })),
}

describe('compression token savings estimates', () => {
  it('forecasts the selected prefix without counting untouched chapters', () => {
    expect(estimateCompressionSavings(preview, 2)).toEqual({ beforeTokens: 90000, summaryTokens: 1250, savedTokens: 88750 })
    expect(estimateCompressionSavings(preview, 1)?.savedTokens).toBe(38750)
  })

  it('counts the existing summary once, instead of compressed originals, for incremental savings', () => {
    const compressed = { ...preview, compressedChapters: 2, summary: '文'.repeat(1600) }
    expect(estimateCompressionSavings(compressed, 1)).toEqual({ beforeTokens: 61000, summaryTokens: 1250, savedTokens: 59750 })
    expect(estimateSavedCompressionTokens(compressed)).toBe(89000)
    const next = { ...compressed, compressedChapters: 3, summary: '文'.repeat(3200) }
    expect(estimateSavedCompressionTokens(next)).toBe(148000)
    expect(estimateSavedCompressionTokens({ ...next, compressedChapters: 0, summary: null })).toBe(0)
  })

  it('avoids negative savings or promises of shrinking very short inputs', () => {
    const short = { ...preview, chapters: [{ label: '短章', tokenEstimate: 100 }], totalChapters: 1 }
    expect(estimateCompressionSavings(short, 1)).toEqual({ beforeTokens: 100, summaryTokens: 100, savedTokens: 0 })
    expect(estimateSavedCompressionTokens({ ...short, compressedChapters: 1, summary: '文'.repeat(3200) })).toBe(0)
  })

  it.each([0, -1, 5, 1.5, NaN])('does not show an estimate for invalid count %s', (count) => {
    expect(estimateCompressionSavings(preview, count)).toBeNull()
  })
})
