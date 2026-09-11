import { describe, expect, it } from 'vitest'
import { decodeEmbeddingVector, encodeEmbeddingVector } from '@/lib/server/embedding-vector'

describe('embedding float32 binary format', () => {
  it('writes explicit little-endian values and reads unaligned buffers', () => {
    expect([...encodeEmbeddingVector([1, -2])]).toEqual([0, 0, 128, 63, 0, 0, 0, 192])
    const unaligned = new Uint8Array(11)
    unaligned.set(encodeEmbeddingVector([0.1, -2]), 3)
    expect(decodeEmbeddingVector(unaligned.subarray(3), 2)).toEqual([Math.fround(0.1), -2])
  })

  it.each([[], [NaN], [Infinity], [-Infinity], [1e40], new Array<number>(3)].map((vector) => ({ vector })))('rejects an invalid vector $vector', ({ vector }) => {
    expect(() => encodeEmbeddingVector(vector)).toThrow()
  })

  it.each([0, -1, 1.5, 3])('rejects invalid or mismatched dimension %s', (dimension) => {
    expect(() => decodeEmbeddingVector(new Uint8Array(8), dimension)).toThrow()
  })

  it('rejects non-finite stored values', () => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setFloat32(0, Infinity, true)
    expect(() => decodeEmbeddingVector(bytes, 1)).toThrow('non-finite')
  })

  it('preserves representative 2560-dimensional retrieval rankings within float32 tolerance', () => {
    const dimensions = 2560
    const query = Array.from({ length: dimensions }, (_, index) => Math.sin(index * 0.03))
    const vectors = [0.2, 0.8, -0.4, 0.5].map((weight) => query.map((value, index) => value * weight + Math.cos(index * 0.7)))
    const similarity = (vector: number[]) => {
      const dot = vector.reduce((sum, value, index) => sum + value * query[index], 0)
      return dot / Math.hypot(...vector) / Math.hypot(...query)
    }
    const original = vectors.map(similarity)
    const rounded = vectors.map((vector) => similarity(decodeEmbeddingVector(encodeEmbeddingVector(vector), dimensions)))
    original.forEach((value, index) => expect(rounded[index]).toBeCloseTo(value, 7))
    const rank = (values: number[]) => values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value).map(({ index }) => index)
    expect(rank(rounded)).toEqual(rank(original))
  })
})
