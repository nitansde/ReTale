import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { AISettings } from '@/lib/types'

const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

function createAiSettings(): AISettings {
  return {
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'rewrite-model',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'ollama-model',
      },
    },
    knowledgeExtraction: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'knowledge-model',
        parallelism: 1,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'knowledge-ollama',
        parallelism: 1,
      },
    },
    embeddings: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'embedding-model',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'embedding-ollama',
      },
      embeddingBatchSize: 16,
    },
  }
}

async function createTestDatabase(prefix: string) {
  const database = new DatabaseSync(`file:${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}?mode=memory&cache=shared`)
  globalForSqlite.sqlite = database
  vi.resetModules()

  const { initializeDatabase, execute, queryOne } = await import('@/lib/server/sqlite')
  initializeDatabase(database)
  execute('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)', 'novel-rewrite', 'Rewrite Fixture', 'txt')
  execute('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)', 'novel-rewrite:main', 'novel-rewrite', 'main')
  execute(
    `INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'chapter-rewrite-1',
    'novel-rewrite',
    'novel-rewrite:main',
    1,
    '第一章',
    '原始章节正文。',
    'hash-rewrite-1',
  )

  return { database, queryOne }
}

function closeTestDatabase() {
  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }
}

function createRewriteRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId: 'novel-rewrite',
      branchId: 'novel-rewrite:main',
      chapterId: 'chapter-rewrite-1',
      selectedText: '选中文本',
      sourceText: '原始章节正文。',
      operationType: 'rewrite',
      userInstruction: '增强压迫感。',
      scope: 'chapter',
      mode: 'heavy',
      tone: 'dramatic',
      rewriteLaunchSource: 'chapter',
      ...payload,
    }),
  })
}

function createAbortRequest(jobId: string, overrides: { novelId?: string; branchId?: string; chapterId?: string } = {}) {
  const searchParams = new URLSearchParams({
    jobId,
    novelId: overrides.novelId ?? 'novel-rewrite',
    branchId: overrides.branchId ?? 'novel-rewrite:main',
    chapterId: overrides.chapterId ?? 'chapter-rewrite-1',
  })
  return new Request(`http://localhost/api/rewrite?${searchParams.toString()}`, { method: 'DELETE' })
}

async function waitForCondition(assertion: () => boolean | Promise<boolean>) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5000) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}

type ImportRewriteRouteOptions = {
  afterImpl?: (callback: () => Promise<void>) => void
}

async function importRewriteRoute(options: ImportRewriteRouteOptions = {}) {
  vi.doMock('@/lib/server/ai-settings', () => ({
    loadStoredAISettings: () => createAiSettings(),
  }))
  vi.doMock('@/lib/server/preset-compat-library', () => ({
    loadStoredPresetCompatLibrary: () => createDefaultPresetCompatLibrary(),
  }))
  vi.doMock('next/server', async () => {
    const actual = await vi.importActual<typeof import('next/server')>('next/server')
    return {
      ...actual,
      after: vi.fn(options.afterImpl ?? (() => undefined)),
    }
  })

  return import('@/app/api/rewrite/route')
}

afterEach(() => {
  vi.useRealTimers()
  closeTestDatabase()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('recoverable rewrite jobs', () => {
  it('stores and restores one completed rewrite result', async () => {
    const { queryOne } = await createTestDatabase('chatbook-rewrite-recoverable')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ result: '完成后的单个改写版本。' }),
          },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true }))
    const created = await createdResponse.json() as { ok: boolean; job: { jobId: string; status: string; result: null } }

    expect(created.ok).toBe(true)
    expect(created.job.status).toBe('queued')
    expect(created.job.result).toBeNull()

    const payloadBeforeRun = JSON.parse(queryOne<{ payloadJson: string }>(
      'SELECT payloadJson FROM KnowledgeJob WHERE id = ?',
      created.job.jobId,
    )?.payloadJson ?? '{}') as { request?: { stream?: unknown; recoverableRewriteJob?: unknown } }
    expect(payloadBeforeRun.request?.stream).toBeUndefined()
    expect(payloadBeforeRun.request?.recoverableRewriteJob).toBeUndefined()

    const duplicateResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true }))
    const duplicate = await duplicateResponse.json() as { job: { jobId: string; status: string } }
    expect(duplicate.job.jobId).toBe(created.job.jobId)
    expect(duplicate.job.status).toBe('queued')

    await runRecoverableRewriteJobForTesting(created.job.jobId)

    const restoredByIdResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const restoredById = await restoredByIdResponse.json() as {
      ok: boolean
      job: { status: string; result: { content: string; provider: string; inputTokens: number | null; outputTokens: number | null } }
    }
    expect(restoredById.ok).toBe(true)
    expect(restoredById.job.status).toBe('succeeded')
    expect(restoredById.job.result.content).toBe('完成后的单个改写版本。')
    expect(restoredById.job.result.provider).toBe('openai-compatible')
    expect(restoredById.job.result.inputTokens).toBe(11)
    expect(restoredById.job.result.outputTokens).toBe(22)

    const restoredByChapterResponse = await GET(new Request('http://localhost/api/rewrite?novelId=novel-rewrite&branchId=novel-rewrite%3Amain&chapterId=chapter-rewrite-1'))
    const restoredByChapter = await restoredByChapterResponse.json() as { job: { jobId: string; result: { content: string } } }
    expect(restoredByChapter.job.jobId).toBe(created.job.jobId)
    expect(restoredByChapter.job.result.content).toBe('完成后的单个改写版本。')
  }, 30000)

  it('exposes partial streamed output while a recoverable rewrite job is running', async () => {
    const { queryOne } = await createTestDatabase('chatbook-rewrite-recoverable-streaming')
    const encoder = new TextEncoder()
    let upstreamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const created = await createdResponse.json() as { ok: boolean; job: { jobId: string; status: string; result: null } }
    expect(created.ok).toBe(true)

    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId)
    await waitForCondition(() => fetchMock.mock.calls.length === 1 && upstreamController !== null)
    const controller = upstreamController
    if (!controller) {
      throw new Error('Expected streaming response controller')
    }

    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'))
    await waitForCondition(async () => {
      const response = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
      const data = await response.json() as { job: { status: string; result: { content: string } | null } }
      return data.job.status === 'running' && data.job.result?.content === '第一段'
    })

    const payloadDuringRun = JSON.parse(queryOne<{ payloadJson: string }>(
      'SELECT payloadJson FROM KnowledgeJob WHERE id = ?',
      created.job.jobId,
    )?.payloadJson ?? '{}') as { request?: { stream?: unknown; recoverableRewriteJob?: unknown }; result?: { content?: string } }
    expect(payloadDuringRun.request?.stream).toBeUndefined()
    expect(payloadDuringRun.request?.recoverableRewriteJob).toBeUndefined()
    expect(payloadDuringRun.result?.content).toBe('第一段')

    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n'))
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
    await runPromise

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string; provider: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('第一段第二段')
    expect(restored.job.result.provider).toBe('openai-compatible')
  }, 30000)

  it('aborts an on-the-fly recoverable rewrite job and excludes it from latest restore', async () => {
    await createTestDatabase('chatbook-rewrite-recoverable-abort')
    let capturedSignal: AbortSignal | null = null
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      capturedSignal = init?.signal ?? null
      capturedSignal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { DELETE, GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const created = await createdResponse.json() as { job: { jobId: string; status: string } }
    expect(created.job.status).toBe('queued')

    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId)
    await waitForCondition(() => capturedSignal !== null)

    const abortResponse = await DELETE(createAbortRequest(created.job.jobId))
    const aborted = await abortResponse.json() as { ok: boolean; job: { jobId: string; status: string } }
    expect(aborted.ok).toBe(true)
    expect(aborted.job.jobId).toBe(created.job.jobId)
    expect(aborted.job.status).toBe('aborted')
    expect(capturedSignal?.aborted).toBe(true)
    await runPromise

    const restoredByIdResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const restoredById = await restoredByIdResponse.json() as { job: { status: string; errorMessage: string | null } }
    expect(restoredById.job.status).toBe('aborted')

    const restoredByChapterResponse = await GET(new Request('http://localhost/api/rewrite?novelId=novel-rewrite&branchId=novel-rewrite%3Amain&chapterId=chapter-rewrite-1'))
    const restoredByChapter = await restoredByChapterResponse.json() as { job: null }
    expect(restoredByChapter.job).toBeNull()

    const nextResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const next = await nextResponse.json() as { job: { jobId: string; status: string } }
    expect(next.job.status).toBe('queued')
    expect(next.job.jobId).not.toBe(created.job.jobId)
  }, 30000)

  it('rejects abort requests outside the recoverable rewrite job scope', async () => {
    await createTestDatabase('chatbook-rewrite-recoverable-abort-scope')
    let capturedSignal: AbortSignal | null = null
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      capturedSignal = init?.signal ?? null
      capturedSignal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { DELETE, GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const created = await createdResponse.json() as { job: { jobId: string; status: string } }
    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId)
    await waitForCondition(() => capturedSignal !== null)

    const wrongScopeResponse = await DELETE(createAbortRequest(created.job.jobId, { branchId: 'novel-rewrite:other' }))
    const wrongScope = await wrongScopeResponse.json() as { ok: boolean; error: string }
    expect(wrongScopeResponse.status).toBe(404)
    expect(wrongScope.ok).toBe(false)
    expect(capturedSignal?.aborted).toBe(false)

    const runningResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const running = await runningResponse.json() as { job: { status: string } }
    expect(running.job.status).toBe('running')

    const abortResponse = await DELETE(createAbortRequest(created.job.jobId))
    expect(abortResponse.status).toBe(200)
    expect(capturedSignal?.aborted).toBe(true)
    await runPromise
  }, 30000)

  it('rejects recoverable rewrite job creation when the requested scope is missing', async () => {
    await createTestDatabase('chatbook-rewrite-recoverable-missing-scope')
    vi.stubGlobal('fetch', vi.fn())

    const { POST } = await importRewriteRoute()
    const response = await POST(createRewriteRequest({
      recoverableRewriteJob: true,
      chapterId: 'missing-chapter',
    }))
    const data = await response.json() as { ok: boolean; error: string }

    expect(response.status).toBe(404)
    expect(data.ok).toBe(false)
    expect(data.error).toBe('Recoverable rewrite job scope not found')
  }, 30000)

  it('throttles tiny streamed partial updates before final completion', async () => {
    await createTestDatabase('chatbook-rewrite-recoverable-streaming-throttle')
    const encoder = new TextEncoder()
    let upstreamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(upstream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })))

    const { GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const created = await createdResponse.json() as { job: { jobId: string } }

    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId)
    await waitForCondition(() => upstreamController !== null)
    const controller = upstreamController
    if (!controller) {
      throw new Error('Expected streaming response controller')
    }

    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"一"}}]}\n\n'))
    await waitForCondition(async () => {
      const response = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
      const data = await response.json() as { job: { result: { content: string } | null } }
      return data.job.result?.content === '一'
    })

    for (let index = 0; index < 50; index += 1) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"一"}}]}\n\n'))
    }

    const throttledResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const throttled = await throttledResponse.json() as { job: { status: string; result: { content: string } | null } }
    expect(throttled.job.status).toBe('running')
    expect(throttled.job.result?.content).toBe('一')

    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
    await runPromise

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('一'.repeat(51))
  }, 30000)

  it('falls back to timer scheduling when after is unavailable', async () => {
    await createTestDatabase('chatbook-rewrite-after-fallback')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'fallback scheduled result' }) } }],
    }), { status: 200 })))
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const { GET, POST } = await importRewriteRoute({
      afterImpl: () => {
        throw new Error('`after` was called outside a request scope')
      },
    })
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true }))
    const created = await createdResponse.json() as { job: { jobId: string; status: string; result: null } }
    expect(created.job.status).toBe('queued')
    expect(setTimeoutSpy).toHaveBeenCalled()

    await waitForCondition(async () => {
      const response = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
      const data = await response.json() as { job: { status: string } }
      return data.job.status === 'succeeded'
    })

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('fallback scheduled result')
  }, 30000)

  it('claims a queued job once when multiple runners race', async () => {
    await createTestDatabase('chatbook-rewrite-claim-once')
    let resolveFetch: ((response: Response) => void) | null = null
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true }))
    const created = await createdResponse.json() as { job: { jobId: string; status: string } }
    expect(created.job.status).toBe('queued')
    const firstRun = runRecoverableRewriteJobForTesting(created.job.jobId)
    const secondRun = runRecoverableRewriteJobForTesting(created.job.jobId)

    await waitForCondition(() => fetchMock.mock.calls.length === 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch?.(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'claimed once result' }) } }],
    }), { status: 200 }))
    await Promise.all([firstRun, secondRun])

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('claimed once result')
  }, 30000)
})
