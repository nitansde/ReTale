import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeClientGetKey, requestClientGet, resetClientRequestBrokerForTests } from '@/lib/client-request-broker'

function deferredResponse() {
  let resolve: (response: Response) => void = () => undefined
  const promise = new Promise<Response>((next) => { resolve = next })
  return { promise, resolve }
}

afterEach(() => {
  resetClientRequestBrokerForTests()
  vi.unstubAllGlobals()
})

describe('client request broker', () => {
  it('normalizes query order while keeping distinct full keys separate', () => {
    expect(normalizeClientGetKey('/api/items?b=2&a=1')).toBe(normalizeClientGetKey('/api/items?a=1&b=2'))
    expect(normalizeClientGetKey('/api/items?a=1')).not.toBe(normalizeClientGetKey('/api/items?a=2'))
  })

  it('shares one in-flight transport between two consumers', async () => {
    const pending = deferredResponse()
    const fetchMock = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const parse = async (response: Response) => response.json() as Promise<{ value: number }>
    const first = requestClientGet('/api/items?b=2&a=1', { parse })
    const second = requestClientGet('/api/items?a=1&b=2', { parse })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/items?b=2&a=1', expect.objectContaining({ cache: 'no-store' }))
    pending.resolve(new Response(JSON.stringify({ value: 7 })))
    await expect(first).resolves.toEqual({ value: 7 })
    await expect(second).resolves.toEqual({ value: 7 })
  })

  it('uses explicit cache modes and keeps different policies on separate transports', async () => {
    const pendingNoStore = deferredResponse()
    const pendingNoCache = deferredResponse()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      init?.cache === 'no-cache' ? pendingNoCache.promise : pendingNoStore.promise
    ))
    vi.stubGlobal('fetch', fetchMock)
    const parse = async (response: Response) => response.text()

    const noStore = requestClientGet('/api/shared-cache', { parse })
    const noCacheOne = requestClientGet('/api/shared-cache', { cache: 'no-cache', parse })
    const noCacheTwo = requestClientGet('/api/shared-cache', { cache: 'no-cache', parse })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/shared-cache', expect.objectContaining({ cache: 'no-store' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/shared-cache', expect.objectContaining({ cache: 'no-cache' }))
    pendingNoStore.resolve(new Response('fresh'))
    pendingNoCache.resolve(new Response('revalidated'))
    await expect(noStore).resolves.toBe('fresh')
    await expect(noCacheOne).resolves.toBe('revalidated')
    await expect(noCacheTwo).resolves.toBe('revalidated')
  })

  it('releases one consumer without aborting a shared request still in use', async () => {
    const pending = deferredResponse()
    let transportSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal ?? undefined
      return pending.promise
    }))
    const firstController = new AbortController()
    const secondController = new AbortController()
    const parse = async (response: Response) => response.text()
    const first = requestClientGet('/api/shared', { parse, signal: firstController.signal })
    const second = requestClientGet('/api/shared', { parse, signal: secondController.signal })
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(transportSignal?.aborted).toBe(false)
    pending.resolve(new Response('ok'))
    await expect(second).resolves.toBe('ok')
  })
})
