import { describe, expect, it, vi } from 'vitest'
import { apiRequestErrorResponse, readJsonObject } from '@/lib/server/api-route'

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/example', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
  })
}

describe('bounded API JSON requests', () => {
  it('accepts JSON with a charset at the exact byte limit', async () => {
    const body = '{"text":"中文"}'
    await expect(readJsonObject(jsonRequest(body, { 'Content-Type': 'application/json; charset=utf-8' }), Buffer.byteLength(body)))
      .resolves.toEqual({ text: '中文' })
  })

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'])('rejects %s before reading', async (mediaType) => {
    await expect(readJsonObject(jsonRequest('{}', { 'Content-Type': mediaType }))).rejects.toMatchObject({ status: 415 })
  })

  it('rejects a missing content type', async () => {
    const request = jsonRequest('{}')
    request.headers.delete('content-type')
    await expect(readJsonObject(request)).rejects.toMatchObject({ status: 415 })
  })

  it.each(['null', '[]', '1', '{bad'])('rejects malformed or non-object JSON: %s', async (body) => {
    await expect(readJsonObject(jsonRequest(body))).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an oversized declared length', async () => {
    await expect(readJsonObject(jsonRequest('{}', { 'Content-Length': '1000' }), 64)).rejects.toMatchObject({ status: 413 })
  })

  it.each([undefined, '1', 'invalid'])('limits streamed bytes independently of Content-Length=%s', async (length) => {
    const cancel = vi.fn()
    const chunks = ['{"text":"', '中文中文中文', '"}']
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (chunk === undefined) controller.close()
        else controller.enqueue(new TextEncoder().encode(chunk))
      },
      cancel,
    })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(length ? { 'Content-Length': length } : {}) },
      body: stream, duplex: 'half',
    }
    const error = await readJsonObject(new Request('http://localhost/api/example', init), 16).catch((error: unknown) => error)
    expect(error).toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
    expect(apiRequestErrorResponse(error)?.status).toBe(413)
  })
})
