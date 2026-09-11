import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ResourceNotFoundError } from '@/lib/server/domain-errors'
import { parseRequestInput } from '@/lib/server/request-validation'

const { createBlock } = vi.hoisted(() => ({ createBlock: vi.fn() }))
vi.mock('@/lib/server/continue-block-service', () => ({ createContinueBlockFromRewrite: createBlock }))
import { POST } from '@/app/api/continue-blocks/route'

describe('typed API errors', () => {
  it.each([
    [new ResourceNotFoundError('The selected chapter is unavailable'), 404],
    [new Error('Provider model not found'), 500],
    [new z.ZodError([{ code: 'custom', path: ['modelOutput'], message: 'Invalid model response' }]), 500],
  ])('maps domain errors without inferring status from wording or output schemas', async (error, status) => {
    createBlock.mockRejectedValueOnce(error)
    const response = await POST(new Request('http://localhost/api/continue-blocks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }))
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
  })

  it('keeps nested field context without serializing all validation issues', () => {
    expect(() => parseRequestInput(z.object({ source: z.object({ chapterNo: z.number().positive() }) }), {
      source: { chapterNo: -1 },
    })).toThrow('source.chapterNo: Number must be greater than 0')
  })
})
