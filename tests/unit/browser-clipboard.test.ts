// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeTextToClipboard } from '@/lib/browser-clipboard'

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalExecCommand) {
    Object.defineProperty(document, 'execCommand', originalExecCommand)
  } else {
    Reflect.deleteProperty(document, 'execCommand')
  }
  document.body.replaceChildren()
})

describe('writeTextToClipboard', () => {
  it('uses the async Clipboard API in secure contexts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await writeTextToClipboard('secure copy')

    expect(writeText).toHaveBeenCalledWith('secure copy')
  })

  it('uses the synchronous copy fallback on plain HTTP origins', async () => {
    const writeText = vi.fn()
    const execCommand = vi.fn(() => true)
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await writeTextToClipboard('plain HTTP copy')

    expect(writeText).not.toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back when the secure Clipboard API rejects the write', async () => {
    const execCommand = vi.fn(() => true)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await writeTextToClipboard('fallback copy')

    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
