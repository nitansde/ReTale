import { describe, expect, it } from 'vitest'
import { buildGeneratedHistoryBatch, HISTORY_COMPRESSION_BATCH_TOKENS } from '@/lib/server/generated-history-batches'
import { estimateTokenCount } from '@/lib/utils'

describe('generated history chapter batches', () => {
  it('groups complete chapters near 50K tokens in chronological order', () => {
    const chapters = ['第一章', '第二章', '第三章'].map((label) => ({ label, content: '剧情'.repeat(16000) }))
    const first = buildGeneratedHistoryBatch(chapters, { chapterIndex: 0, offset: 0 }, HISTORY_COMPRESSION_BATCH_TOKENS)
    expect(first.material).toBe(`【第一章】\n${chapters[0].content}\n\n【第二章】\n${chapters[1].content}`)
    expect(first.next).toEqual({ chapterIndex: 2, offset: 0 })
    expect(estimateTokenCount(first.material)).toBeGreaterThan(39000)
    expect(estimateTokenCount(first.material)).toBeLessThanOrEqual(50000)
    const second = buildGeneratedHistoryBatch(chapters, first.next, HISTORY_COMPRESSION_BATCH_TOKENS)
    expect(second.material).toBe(`【第三章】\n${chapters[2].content}`)
    expect(second.next.chapterIndex).toBe(chapters.length)
  })

  it('starts a new batch instead of splitting a chapter that fits by itself', () => {
    const chapters = [{ label: '短章', content: '甲'.repeat(25000) }, { label: '长章', content: '乙'.repeat(60000) }]
    const first = buildGeneratedHistoryBatch(chapters, { chapterIndex: 0, offset: 0 }, 50000)
    expect(first.material).not.toContain('乙')
    const second = buildGeneratedHistoryBatch(chapters, first.next, 50000)
    expect(second.material).toContain(chapters[1].content)
    expect(second.next).toEqual({ chapterIndex: 2, offset: 0 })
  })

  it.each(['开场。\n\n' + '雨落下来，故事仍在继续。😀\n'.repeat(9000), '😀'.repeat(50001)])('splits an oversized chapter without losing characters or breaking surrogate pairs', (content) => {
    const chapter = { label: '超长章', content }
    const pieces: string[] = []
    let cursor = { chapterIndex: 0, offset: 0 }
    while (cursor.chapterIndex === 0) {
      const batch = buildGeneratedHistoryBatch([chapter], cursor, 12001)
      expect(estimateTokenCount(batch.material)).toBeLessThanOrEqual(12001)
      const piece = batch.material.slice('【超长章】\n'.length)
      expect(piece).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
      pieces.push(piece)
      cursor = batch.next
    }
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join('')).toBe(content)
  })
})
