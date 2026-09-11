import { describe, expect, it } from 'vitest'
import { formatProgressMessage, isRawEmbeddingProgress, parseProgressMessage, progressMessage } from '@/lib/i18n/progress-message'
import { getMessage } from '@/lib/i18n/messages'
import { type ProgressMessageKey } from '@/lib/i18n/progress-messages'

const en = (key: ProgressMessageKey, values?: Record<string, string | number>) => getMessage('en', key, values)
const zh = (key: ProgressMessageKey, values?: Record<string, string | number>) => getMessage('zh', key, values)

describe('persisted progress messages', () => {
  it('renders the same stored key and parameters in either locale', () => {
    const stored = progressMessage('progress.extractBatch', { remaining: 12, batch: 3, concurrency: 2 })
    expect(parseProgressMessage(stored)).toEqual({ key: 'progress.extractBatch', values: { remaining: 12, batch: 3, concurrency: 2 } })
    expect(formatProgressMessage(stored, en)).toBe('Extracting candidate knowledge (12 chapters remaining, 3 in this batch, up to 2 concurrent)')
    expect(formatProgressMessage(stored, zh)).toBe('并行抽取候选知识（剩余 12 章，本批 3 章，最大并发 2）')
  })

  it('requires stored keys and leaves unconverted text unchanged', () => {
    expect(parseProgressMessage('并行抽取候选知识（已完成第 702 章）')).toBeNull()
    expect(formatProgressMessage('并行抽取候选知识（已完成第 702 章）', en)).toBe('并行抽取候选知识（已完成第 702 章）')
  })

  it.each([
    'Custom worker diagnostic',
    '@retale-progress:invalid-json',
    '@retale-progress:{"key":"progress.unknown"}',
    '@retale-progress:{"key":"toString"}',
    '@retale-progress:{"key":"progress.completed","values":[]}',
    '@retale-progress:{"key":"progress.completed","values":{"nested":{}}}',
  ])('preserves unknown or malformed text: %s', (text) => {
    expect(formatProgressMessage(text, en)).toBe(text)
  })

  it('uses only stable keys for embedding state', () => {
    expect(isRawEmbeddingProgress(progressMessage('progress.rawEmbeddingWait'))).toBe(true)
    expect(isRawEmbeddingProgress('等待原文 Embedding 预计算完成')).toBe(false)
    expect(isRawEmbeddingProgress('Waiting for raw text embedding')).toBe(false)
    expect(isRawEmbeddingProgress(progressMessage('progress.extract'))).toBe(false)
    expect(formatProgressMessage(null, en)).toBeNull()
  })
})
