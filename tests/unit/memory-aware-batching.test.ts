import { describe, expect, it } from 'vitest'
import { resolveMemoryAwareEmbeddingBatchPlan } from '@/lib/server/memory-aware-batching'

const GIB = 1024 ** 3

describe('memory-aware embedding batching', () => {
  it('caps the installed 4B local model conservatively on a 16 GiB system', () => {
    expect(resolveMemoryAwareEmbeddingBatchPlan({
      provider: 'openai-compatible',
      model: 'qwen3-embedding-4b-q4_k_m',
      requestedBatchSize: 32,
      totalMemoryBytes: 16 * GIB,
    })).toMatchObject({
      requestedBatchSize: 32,
      effectiveBatchSize: 4,
      maxConcurrentBatches: 1,
      localWorkload: true,
      modelMemoryMaxBytes: 6_500_000_000,
    })
  })

  it('reduces the 8B model to singleton requests on a 16 GiB system', () => {
    expect(resolveMemoryAwareEmbeddingBatchPlan({
      provider: 'openai-compatible',
      model: 'qwen3-embedding-8b-q4_k_m',
      requestedBatchSize: 32,
      totalMemoryBytes: 16 * GIB,
    }).effectiveBatchSize).toBe(1)
  })

  it('treats Ollama as local even when its model is not in the bundled catalog', () => {
    expect(resolveMemoryAwareEmbeddingBatchPlan({
      provider: 'ollama',
      model: 'qwen3-embedding:4b',
      requestedBatchSize: 32,
      totalMemoryBytes: 12 * GIB,
    })).toMatchObject({
      effectiveBatchSize: 2,
      maxConcurrentBatches: 1,
      localWorkload: true,
    })
  })

  it('leaves remote embedding provider batch sizes unchanged', () => {
    expect(resolveMemoryAwareEmbeddingBatchPlan({
      provider: 'openai-compatible',
      model: 'text-embedding-3-large',
      requestedBatchSize: 64,
      totalMemoryBytes: 8 * GIB,
    })).toMatchObject({
      effectiveBatchSize: 64,
      maxConcurrentBatches: 2,
      localWorkload: false,
    })
  })
})
