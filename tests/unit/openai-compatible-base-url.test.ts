import { describe, expect, it } from 'vitest'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/server/openai-compatible'

describe('normalizeOpenAICompatibleBaseUrl', () => {
  it.each([
    'http://192.168.68.20:8000/v1',
    'http://100.64.0.20:8080/v1',
    'http://llm.internal:9000/v1',
    'https://api.example.com/v1',
  ])('accepts HTTP and HTTPS provider endpoints: %s', (baseUrl) => {
    expect(normalizeOpenAICompatibleBaseUrl(`${baseUrl}/`)).toBe(baseUrl)
  })

  it.each([
    'ftp://provider.example/v1',
    'file:///tmp/provider',
    'ws://provider.example/v1',
  ])('rejects non-HTTP provider protocols: %s', (baseUrl) => {
    expect(() => normalizeOpenAICompatibleBaseUrl(baseUrl)).toThrow('must use HTTP or HTTPS')
  })

  it('continues to reject credentials, query strings, and fragments', () => {
    expect(() => normalizeOpenAICompatibleBaseUrl('http://user:pass@192.168.1.2/v1')).toThrow('must not include credentials')
    expect(() => normalizeOpenAICompatibleBaseUrl('http://192.168.1.2/v1?token=value')).toThrow('must not include query')
    expect(() => normalizeOpenAICompatibleBaseUrl('http://192.168.1.2/v1#models')).toThrow('must not include query')
  })
})
