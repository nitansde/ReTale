import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuid } from '@/lib/utils'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createUuid', () => {
  it('uses crypto.randomUUID when the browser exposes it', () => {
    const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000')
    vi.stubGlobal('crypto', { randomUUID })

    expect(createUuid()).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('creates an RFC 4122 version 4 UUID when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab)
        return bytes
      },
    })

    expect(createUuid()).toBe('abababab-abab-4bab-abab-abababababab')
  })
})
