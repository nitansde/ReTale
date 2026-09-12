import { describe, expect, it } from 'vitest'
import { parseAllowedApiOrigins, protectApiRequest } from '@/lib/server/api-origin'

function request(headers: Record<string, string> = {}, method = 'POST') {
  return new Request('http://0.0.0.0:14500/api/settings/ai', {
    method,
    headers: { Host: 'retale.example:14500', ...headers },
  })
}

describe('API browser origin protection', () => {
  it('accepts the actual same-origin host even when Next uses a bind address', () => {
    const response = protectApiRequest(request({ Origin: 'http://retale.example:14500', 'Sec-Fetch-Site': 'same-origin' }), [])
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(response.headers.get('vary')).toContain('Accept-Encoding')
  })

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'rejects foreign origins on %s, including simple requests and preflight', async (method) => {
      const response = protectApiRequest(request({ Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, method), [])
      expect(response.status).toBe(403)
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
      await expect(response.json()).resolves.toMatchObject({ ok: false })
    },
  )

  it.each(['null', 'http://retale.example:3000', 'https://retale.example:14500', 'http://other.retale.example:14500'])(
    'rejects opaque or different origins: %s', (origin) => {
      expect(protectApiRequest(request({ Origin: origin }), []).status).toBe(403)
    },
  )

  it('does not trust forwarded hosts to authorize a foreign page', () => {
    expect(protectApiRequest(request({ Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' }), []).status).toBe(403)
  })

  it.each(['cross-site', 'same-site'])('rejects origin-less browser requests from %s', (site) => {
    expect(protectApiRequest(request({ 'Sec-Fetch-Site': site }), []).status).toBe(403)
  })

  it('supports origin-less CLI clients and ordinary same-origin browser reads', () => {
    expect(protectApiRequest(request(), []).headers.get('x-middleware-next')).toBe('1')
    expect(protectApiRequest(request({ 'Sec-Fetch-Site': 'same-origin' }, 'GET'), []).status).toBe(200)
  })

  it('echoes only an explicitly allowed origin and permits its preflight', () => {
    const origin = 'https://trusted.example'
    const response = protectApiRequest(request({ Origin: origin, 'Sec-Fetch-Site': 'cross-site' }, 'OPTIONS'), [origin])
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-methods')).toContain('PUT')
    expect(response.headers.get('access-control-allow-headers')).toContain('Idempotency-Key')
    expect(response.headers.get('vary')).toContain('Origin')
    expect(protectApiRequest(request({ Origin: 'https://evil.example' }), [origin]).status).toBe(403)
  })

  it('rejects contradictory cross-site metadata even with a matching Origin', () => {
    expect(protectApiRequest(request({ Origin: 'http://retale.example:14500', 'Sec-Fetch-Site': 'cross-site' }), []).status).toBe(403)
  })
})

describe('explicit API origin configuration', () => {
  it('defaults to no cross-origin access and parses exact origins', () => {
    expect(parseAllowedApiOrigins(undefined)).toEqual([])
    expect(parseAllowedApiOrigins(' https://trusted.example, http://localhost:4000 ')).toEqual(['https://trusted.example', 'http://localhost:4000'])
  })
  it.each(['*', 'https://*.example', 'null', 'https://example/path', 'https://example/', 'https://user:pass@example', 'file:///tmp'])('rejects %s', (value) => {
    expect(() => parseAllowedApiOrigins(value)).toThrow()
  })
})
