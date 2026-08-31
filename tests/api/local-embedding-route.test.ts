import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

function installRequest(body: Record<string, unknown>, origin = 'http://localhost') {
  return new Request('http://localhost/api/settings/ai/local-embedding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  })
}

describe('local embedding settings route', () => {
  it('rejects cross-origin installation before touching the runtime', async () => {
    const beginLocalEmbeddingInstall = vi.fn()
    vi.doMock('@/lib/server/local-embedding-runtime', () => ({
      beginCustomLocalEmbeddingInstall: vi.fn(),
      beginLocalEmbeddingInstall,
      beginLocalEmbeddingStart: vi.fn(),
      getLocalEmbeddingRuntimeStatus: vi.fn(),
      stopLocalEmbeddingRuntime: vi.fn(),
    }))
    const { POST } = await import('@/app/api/settings/ai/local-embedding/route')
    const response = await POST(installRequest({ action: 'install', modelId: 'qwen3-embedding-0.6b-q8_0' }, 'https://evil.example'))
    expect(response.status).toBe(403)
    expect(beginLocalEmbeddingInstall).not.toHaveBeenCalled()
  })

  it('rejects unknown models with stable 400 JSON', async () => {
    const { POST } = await import('@/app/api/settings/ai/local-embedding/route')
    const response = await POST(installRequest({ action: 'install', modelId: 'unknown-model' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unknown local embedding model' })
  })

  it('does not accept caller-controlled download URLs', async () => {
    const beginLocalEmbeddingInstall = vi.fn()
    vi.doMock('@/lib/server/local-embedding-runtime', () => ({
      beginCustomLocalEmbeddingInstall: vi.fn(),
      beginLocalEmbeddingInstall,
      beginLocalEmbeddingStart: vi.fn(),
      getLocalEmbeddingRuntimeStatus: vi.fn(),
      stopLocalEmbeddingRuntime: vi.fn(),
    }))
    const { POST } = await import('@/app/api/settings/ai/local-embedding/route')
    const response = await POST(installRequest({
      action: 'install',
      modelId: 'qwen3-embedding-0.6b-q8_0',
      url: 'https://evil.example/payload',
    }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unexpected field: url' })
    expect(beginLocalEmbeddingInstall).not.toHaveBeenCalled()
  })

  it('starts a catalog installation asynchronously', async () => {
    const status = { ok: true, phase: 'downloading-runtime' }
    const beginLocalEmbeddingInstall = vi.fn().mockResolvedValue(status)
    vi.doMock('@/lib/server/local-embedding-runtime', () => ({
      beginCustomLocalEmbeddingInstall: vi.fn(),
      beginLocalEmbeddingInstall,
      beginLocalEmbeddingStart: vi.fn(),
      getLocalEmbeddingRuntimeStatus: vi.fn(),
      stopLocalEmbeddingRuntime: vi.fn(),
    }))
    const { POST } = await import('@/app/api/settings/ai/local-embedding/route')
    const response = await POST(installRequest({ action: 'install', modelId: 'qwen3-embedding-0.6b-q8_0' }))
    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(beginLocalEmbeddingInstall).toHaveBeenCalledWith('qwen3-embedding-0.6b-q8_0')
  })

  it('accepts a twice-confirmed custom GGUF reference without accepting a caller URL', async () => {
    const status = { ok: true, phase: 'downloading-runtime' }
    const beginCustomLocalEmbeddingInstall = vi.fn().mockResolvedValue(status)
    vi.doMock('@/lib/server/local-embedding-runtime', () => ({
      beginCustomLocalEmbeddingInstall,
      beginLocalEmbeddingInstall: vi.fn(),
      beginLocalEmbeddingStart: vi.fn(),
      getLocalEmbeddingRuntimeStatus: vi.fn(),
      stopLocalEmbeddingRuntime: vi.fn(),
    }))
    const { POST } = await import('@/app/api/settings/ai/local-embedding/route')
    const response = await POST(installRequest({
      action: 'install-custom',
      repository: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
      fileName: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
      riskAccepted: true,
      installConfirmed: true,
    }))
    expect(response.status).toBe(202)
    expect(beginCustomLocalEmbeddingInstall).toHaveBeenCalledWith({
      repository: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
      fileName: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
    })
  })

  it('rejects custom installs without risk confirmation or with URL-shaped input', async () => {
    const beginCustomLocalEmbeddingInstall = vi.fn()
    vi.doMock('@/lib/server/local-embedding-runtime', () => ({
      beginCustomLocalEmbeddingInstall,
      beginLocalEmbeddingInstall: vi.fn(),
      beginLocalEmbeddingStart: vi.fn(),
      getLocalEmbeddingRuntimeStatus: vi.fn(),
      stopLocalEmbeddingRuntime: vi.fn(),
    }))
    const { POST } = await import('@/app/api/settings/ai/local-embedding/route')

    const unconfirmed = await POST(installRequest({
      action: 'install-custom',
      repository: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
      fileName: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
      riskAccepted: false,
    }))
    expect(unconfirmed.status).toBe(400)

    const secondConfirmationMissing = await POST(installRequest({
      action: 'install-custom',
      repository: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
      fileName: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
      riskAccepted: true,
    }))
    expect(secondConfirmationMissing.status).toBe(400)

    const arbitraryUrl = await POST(installRequest({
      action: 'install-custom',
      repository: 'https://evil.example/model',
      fileName: 'payload.gguf',
      riskAccepted: true,
      installConfirmed: true,
    }))
    expect(arbitraryUrl.status).toBe(400)
    expect(beginCustomLocalEmbeddingInstall).not.toHaveBeenCalled()
  })
})
