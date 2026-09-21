import { describe, expect, it } from 'vitest'
import { encodeRewriteStream, readRewriteStream, REWRITE_STREAM_CONTENT_TYPE } from '@/lib/rewrite-stream'
import { extractProviderErrorDetail } from '@/lib/server/provider-request'

describe('writing stream error transport', () => {
  it('round-trips Chinese text even when UTF-8 characters cross source chunks', async () => {
    const bytes = new TextEncoder().encode('他们说：“继续吧。”\n下一章')
    let offset = 0
    const source = new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset === bytes.length) controller.close()
      else controller.enqueue(bytes.slice(offset, ++offset))
    } })
    let text = ''
    await readRewriteStream(new Response(encodeRewriteStream(source), { headers: { 'Content-Type': REWRITE_STREAM_CONTENT_TYPE } }), (chunk) => { text += chunk })
    expect(text).toBe('他们说：“继续吧。”\n下一章')
  })

  it('delivers a sanitized mid-stream error instead of accepting a partial completion', async () => {
    let sent = false
    const source = new ReadableStream<Uint8Array>({ pull(controller) {
      if (sent) throw new Error('context_length_exceeded; Authorization: Bearer secret-value')
      sent = true
      controller.enqueue(new TextEncoder().encode('未完成的段落'))
    } })
    const response = new Response(encodeRewriteStream(source), { headers: { 'Content-Type': REWRITE_STREAM_CONTENT_TYPE } })
    // Cross the HTTP boundary as bytes, so an exception on the source alone cannot pass this test.
    const wire = await response.text()
    expect(wire).not.toContain('secret-value')
    expect(wire).not.toContain('"type":"done"')
    let partial = ''
    await expect(readRewriteStream(new Response(wire, { headers: response.headers }), (chunk) => { partial += chunk })).rejects.toThrow('context_length_exceeded')
    expect(partial).toBe('未完成的段落')
  })

  it('rejects truncated framed responses without a completion event', async () => {
    const response = new Response('{"type":"text","text":"partial"}\n', { headers: { 'Content-Type': REWRITE_STREAM_CONTENT_TYPE } })
    await expect(readRewriteStream(response, () => undefined)).rejects.toThrow('before generation completed')
  })

  it('cancels a pending model stream without emitting a spurious failure', async () => {
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const reader = encodeRewriteStream(source).getReader()
    const pending = reader.read()
    await reader.cancel('user stopped')
    await expect(pending).resolves.toMatchObject({ done: true })
    expect(cancelled).toBe(true)
  })
})

describe('provider failure diagnostics', () => {
  it.each([
    ['{"error":{"message":"maximum context length is 200000 tokens"}}', 'maximum context length is 200000 tokens'],
    ['{"error":{"message":"request rejected","code":"context_length_exceeded"}}', 'request rejected (context_length_exceeded)'],
    ['{"error":"model requires more system memory"}', 'model requires more system memory'],
    ['{"detail":"Too many requests"}', 'Too many requests'],
    ['Invalid API key', 'Invalid API key'],
    ['<html><body>Bad gateway</body></html>', ''],
    ['{"broken', ''],
    ['{"error":{"message":"denied; api_key=secret-value"},"request":{"prompt":"private story"}}', 'denied; api_key=[REDACTED]'],
  ])('extracts only the useful error from %s', (body, expected) => {
    expect(extractProviderErrorDetail(body)).toBe(expected)
  })
})
