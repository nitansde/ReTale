import { afterEach, describe, expect, it, vi } from 'vitest'

function createGenerationContextRequest(operationType: unknown) {
  return new Request('http://localhost/api/rag/build-generation-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId: 'novel-001',
      chapterId: 'chapter-001',
      selectedText: '选段',
      userInstruction: '指令',
      operationType,
    }),
  })
}

function createGraphContextRequest(operationType: unknown) {
  return new Request('http://localhost/api/rag/graph-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      chapterNo: 3,
      selectedText: '选段',
      nearbyText: '附近文本',
      operationType,
    }),
  })
}

function createContextPreviewRequest(operationType: unknown) {
  return new Request('http://localhost/api/context-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId: 'novel-001',
      chapterId: 'chapter-001',
      selectedText: '选段',
      userInstruction: '指令',
      operationType,
    }),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('request-boundary operation type validation', () => {
  it.each(['expand', 'polish', 'continue', 'totally-unknown-mode'])('rejects invalid generation-context operation type %s with a 400', async (operationType) => {
    const buildGenerationContext = vi.fn()
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext,
    }))

    const { POST } = await import('@/app/api/rag/build-generation-context/route')
    const response = await POST(createGenerationContextRequest(operationType))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid operationType. Expected one of: rewrite, future_jump, roleplay',
    })
    expect(buildGenerationContext).not.toHaveBeenCalled()
  })

  it.each(['expand', 'polish', 'continue', 'totally-unknown-mode'])('rejects invalid graph-context operation type %s with a 400', async (operationType) => {
    const buildChapterGraphContext = vi.fn()
    const buildGraphAwareContext = vi.fn()
    vi.doMock('@/lib/server/context-builder', () => ({
      buildChapterGraphContext,
    }))
    vi.doMock('@/lib/server/graph-context', () => ({
      buildGraphAwareContext,
    }))

    const { POST } = await import('@/app/api/rag/graph-context/route')
    const response = await POST(createGraphContextRequest(operationType))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid operationType. Expected one of: rewrite, future_jump, roleplay',
    })
    expect(buildGraphAwareContext).not.toHaveBeenCalled()
    expect(buildChapterGraphContext).not.toHaveBeenCalled()
  })

  it.each([undefined, 'expand', 'polish', 'continue', 'totally-unknown-mode'])('rejects invalid context-preview operation type %s with a 400', async (operationType) => {
    const buildGenerationContextPreview = vi.fn()
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContextPreview,
    }))

    const { POST } = await import('@/app/api/context-preview/route')
    const response = await POST(createContextPreviewRequest(operationType))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid operationType. Expected one of: rewrite, future_jump, roleplay',
    })
    expect(buildGenerationContextPreview).not.toHaveBeenCalled()
  })
})
