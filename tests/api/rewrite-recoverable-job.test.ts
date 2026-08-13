import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { AISettings } from '@/lib/types'

const originalTaskStaleTimeoutMs = process.env.RETALE_TASK_STALE_TIMEOUT_MS
const originalTaskMaxRetries = process.env.RETALE_TASK_MAX_RETRIES
const originalDataDir = process.env.RETALE_DATA_DIR
const originalDatabaseUrl = process.env.DATABASE_URL

const cleanupDirectories: string[] = []
type TestSQLiteValue = string | number | bigint | Uint8Array | null

function restoreEnvVar(name: 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanupDirectories.push(tempRoot)
  process.env.RETALE_DATA_DIR = path.join(tempRoot, 'data')
  process.env.DATABASE_URL = path.join(process.env.RETALE_DATA_DIR, 'novels', 'novel-rewrite', 'novel.db')
  vi.resetModules()

  const { getNovelDb, resetResolvedDatabasesForTests } = await import('@/lib/server/db-resolver')
  const database = getNovelDb('novel-rewrite')
  database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-rewrite', 'Rewrite Fixture', 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-rewrite:main', 'novel-rewrite', 'main')
  database.prepare(
    `INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('chapter-rewrite-1', 'novel-rewrite', 'novel-rewrite:main', 1, '第一章', '原始章节正文。', 'hash-rewrite-1')

  return {
    database,
    queryOne: <T>(sql: string, ...params: TestSQLiteValue[]) => (database.prepare(sql).get(...params) as T | undefined) ?? null,
    resetResolvedDatabasesForTests,
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
  aiSettings?: AISettings
}

async function importRewriteRoute(options: ImportRewriteRouteOptions = {}) {
  vi.doMock('@/lib/server/ai-settings', () => ({
    loadStoredAISettings: () => options.aiSettings ?? createAiSettings(),
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

afterEach(async () => {
  vi.useRealTimers()
  process.env.RETALE_TASK_STALE_TIMEOUT_MS = originalTaskStaleTimeoutMs
  process.env.RETALE_TASK_MAX_RETRIES = originalTaskMaxRetries
  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)
  process.env.DATABASE_URL = originalDatabaseUrl
  const resolverModule = await import('@/lib/server/db-resolver')
  resolverModule.resetResolvedDatabasesForTests()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()

  while (cleanupDirectories.length > 0) {
    const directory = cleanupDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('recoverable rewrite jobs', () => {
  it('stores and restores one completed rewrite result', async () => {
    const { queryOne } = await createTestDatabase('retale-rewrite-recoverable')
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

    await runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')

    const restoredByIdResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    expect(restoredByIdResponse.headers.get('cache-control')).toBe('no-store')
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
    const { queryOne } = await createTestDatabase('retale-rewrite-recoverable-streaming')
    const encoder = new TextEncoder()
    const streamControl: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null }
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamControl.controller = controller
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

    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')
    await waitForCondition(() => fetchMock.mock.calls.length === 1 && streamControl.controller !== null)
    const controller = streamControl.controller
    if (!controller) {
      throw new Error('Expected streaming response controller')
    }

    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'))
    await waitForCondition(async () => {
      const response = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
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

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string; provider: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('第一段第二段')
    expect(restored.job.result.provider).toBe('openai-compatible')
  }, 30000)

  it('aborts an on-the-fly recoverable rewrite job and excludes it from latest restore', async () => {
    await createTestDatabase('retale-rewrite-recoverable-abort')
    const fetchControl: { signal: AbortSignal | null } = { signal: null }
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      fetchControl.signal = init?.signal ?? null
      fetchControl.signal?.addEventListener('abort', () => {
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

    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')
    await waitForCondition(() => fetchControl.signal !== null)

    const abortResponse = await DELETE(createAbortRequest(created.job.jobId))
    const aborted = await abortResponse.json() as { ok: boolean; job: { jobId: string; status: string } }
    expect(aborted.ok).toBe(true)
    expect(aborted.job.jobId).toBe(created.job.jobId)
    expect(aborted.job.status).toBe('aborted')
    expect(fetchControl.signal?.aborted).toBe(true)
    await runPromise

    const restoredByIdResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
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
    await createTestDatabase('retale-rewrite-recoverable-abort-scope')
    const fetchControl: { signal: AbortSignal | null } = { signal: null }
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      fetchControl.signal = init?.signal ?? null
      fetchControl.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { DELETE, GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const created = await createdResponse.json() as { job: { jobId: string; status: string } }
    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')
    await waitForCondition(() => fetchControl.signal !== null)

    const wrongScopeResponse = await DELETE(createAbortRequest(created.job.jobId, { branchId: 'novel-rewrite:other' }))
    const wrongScope = await wrongScopeResponse.json() as { ok: boolean; error: string }
    expect(wrongScopeResponse.status).toBe(404)
    expect(wrongScope.ok).toBe(false)
    expect(fetchControl.signal?.aborted).toBe(false)

    const runningResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    const running = await runningResponse.json() as { job: { status: string } }
    expect(running.job.status).toBe('running')

    const abortResponse = await DELETE(createAbortRequest(created.job.jobId))
    expect(abortResponse.status).toBe(200)
    expect(fetchControl.signal?.aborted).toBe(true)
    await runPromise
  }, 30000)

  it('stores recoverable rewrite jobs only in the target novel database', async () => {
    const { database } = await createTestDatabase('retale-rewrite-per-novel-isolation')
    const resolver = await import('@/lib/server/db-resolver')
    const betaDb = resolver.getNovelDb('novel-beta')
    betaDb.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-beta', 'Beta Fixture', 'txt')
    betaDb.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-beta:main', 'novel-beta', 'main')
    betaDb.prepare(
      `INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('chapter-beta-1', 'novel-beta', 'novel-beta:main', 1, 'Beta 第一章', 'Beta 原文。', 'hash-beta-1')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: '完成后的单个改写版本。' }) } }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    }), { status: 200 })))

    const { GET, POST } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true }))
    const created = await createdResponse.json() as { job: { jobId: string } }

    expect(database.prepare('SELECT COUNT(*) AS count FROM KnowledgeJob WHERE id = ?').get(created.job.jobId)).toMatchObject({ count: 1 })
    expect(betaDb.prepare('SELECT COUNT(*) AS count FROM KnowledgeJob WHERE id = ?').get(created.job.jobId)).toMatchObject({ count: 0 })

    const betaScopedResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-beta`))
    await expect(betaScopedResponse.json()).resolves.toMatchObject({ ok: true, job: null })
  }, 30000)

  it('rejects recoverable rewrite job creation when the requested scope is missing', async () => {
    await createTestDatabase('retale-rewrite-recoverable-missing-scope')
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

  it('fails recoverable rewrite jobs when the rewrite provider is not configured instead of fabricating a result', async () => {
    await createTestDatabase('retale-rewrite-recoverable-missing-provider')
    vi.stubGlobal('fetch', vi.fn())

    const aiSettings = createAiSettings()
    aiSettings.rewrite.openAICompatible = {
      ...aiSettings.rewrite.openAICompatible,
      apiKey: '',
      apiKeyConfigured: false,
      configured: false,
    }

    const { GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute({ aiSettings })
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const created = await createdResponse.json() as { ok: boolean; job: { jobId: string; status: string } }

    expect(created.ok).toBe(true)
    expect(created.job.status).toBe('queued')

    await runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    const restored = await restoredResponse.json() as {
      ok: boolean
      job: {
        status: string
        errorMessage: string | null
        result: null
      }
    }

    expect(restored.ok).toBe(true)
    expect(restored.job.status).toBe('failed')
    expect(restored.job.result).toBeNull()
    expect(restored.job.errorMessage).toBe('OpenAI-compatible config not set')
  }, 30000)

  it('throttles tiny streamed partial updates before final completion', async () => {
    await createTestDatabase('retale-rewrite-recoverable-streaming-throttle')
    const encoder = new TextEncoder()
    const streamControl: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null }
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamControl.controller = controller
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(upstream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })))

    const { GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true, stream: true }))
    const created = await createdResponse.json() as { job: { jobId: string } }

    const runPromise = runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')
    await waitForCondition(() => streamControl.controller !== null)
    const controller = streamControl.controller
    if (!controller) {
      throw new Error('Expected streaming response controller')
    }

    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"一"}}]}\n\n'))
    await waitForCondition(async () => {
    const response = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
      const data = await response.json() as { job: { result: { content: string } | null } }
      return data.job.result?.content === '一'
    })

    for (let index = 0; index < 50; index += 1) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"一"}}]}\n\n'))
    }

    const throttledResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    const throttled = await throttledResponse.json() as { job: { status: string; result: { content: string } | null } }
    expect(throttled.job.status).toBe('running')
    expect(throttled.job.result?.content).toBe('一')

    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
    await runPromise

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('一'.repeat(51))
  }, 30000)

  it('falls back to timer scheduling when after is unavailable', async () => {
    await createTestDatabase('retale-rewrite-after-fallback')
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
    const response = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
      const data = await response.json() as { job: { status: string } }
      return data.job.status === 'succeeded'
    })

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('fallback scheduled result')
  }, 30000)

  it('requeues stale recoverable rewrite jobs on GET and schedules them again', async () => {
    process.env.RETALE_TASK_STALE_TIMEOUT_MS = '1000'
    process.env.RETALE_TASK_MAX_RETRIES = '1'

    const { database, queryOne } = await createTestDatabase('retale-rewrite-watchdog-get')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'watchdog resumed result' }) } }],
    }), { status: 200 })))

    const payloadJson = JSON.stringify({
      request: {
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
      },
      panel: {
        novelId: 'novel-rewrite',
        branchId: 'novel-rewrite:main',
        chapterId: 'chapter-rewrite-1',
        selectedText: '选中文本',
        sourceText: '原始章节正文。',
        sourceTextOverride: null,
        userInstruction: '增强压迫感。',
        rewriteLaunchSource: 'chapter',
        branchContextNodeId: null,
        branchContextInclusion: null,
        continueBlockId: null,
        createdAt: new Date().toISOString(),
      },
    })

    database.prepare(
      `INSERT INTO KnowledgeJob (
        id, novelId, branchId, jobType, status, progress, currentStep, payloadJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, 'rewrite_generation', 'running', ?, ?, ?, datetime('now', '-10 seconds'), datetime('now', '-10 seconds'))`
    ).run('rewrite-watchdog-get', 'novel-rewrite', 'novel-rewrite:main', 0.4, '生成中', payloadJson)

    let scheduledRun: Promise<void> | null = null
    const { GET } = await importRewriteRoute({
      afterImpl: (callback) => {
        scheduledRun = callback()
      },
    })

    const response = await GET(new Request('http://localhost/api/rewrite?jobId=rewrite-watchdog-get&novelId=novel-rewrite'))
    const data = await response.json() as { ok: boolean; job: { jobId: string; status: string; errorMessage: string | null } }

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.job.jobId).toBe('rewrite-watchdog-get')
    expect(data.job.status).toBe('queued')
    expect(data.job.errorMessage).toContain('无进度更新')

    await waitForCondition(() => {
      const row = queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', 'rewrite-watchdog-get')
      return row?.status === 'succeeded'
    })
    await scheduledRun

    const completedRow = queryOne<{ status: string; payloadJson: string }>(
      'SELECT status, payloadJson FROM KnowledgeJob WHERE id = ?',
      'rewrite-watchdog-get',
    )
    const completedPayload = JSON.parse(completedRow?.payloadJson ?? '{}') as {
      taskWatchdog?: { attemptCount?: number; lastAction?: string }
      result?: { content?: string }
    }

    expect(completedRow?.status).toBe('succeeded')
    expect(completedPayload.taskWatchdog).toMatchObject({ attemptCount: 1, lastAction: 'retried' })
    expect(completedPayload.result?.content).toBe('watchdog resumed result')
  }, 30000)

  it('requeues stale duplicate recoverable rewrite jobs during creation and reuses the same job', async () => {
    process.env.RETALE_TASK_STALE_TIMEOUT_MS = '1000'
    process.env.RETALE_TASK_MAX_RETRIES = '1'

    const { database, queryOne } = await createTestDatabase('retale-rewrite-watchdog-create')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'watchdog reused result' }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const payloadJson = JSON.stringify({
      request: {
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
      },
      panel: {
        novelId: 'novel-rewrite',
        branchId: 'novel-rewrite:main',
        chapterId: 'chapter-rewrite-1',
        selectedText: '选中文本',
        sourceText: '原始章节正文。',
        sourceTextOverride: null,
        userInstruction: '增强压迫感。',
        rewriteLaunchSource: 'chapter',
        branchContextNodeId: null,
        branchContextInclusion: null,
        continueBlockId: null,
        createdAt: new Date().toISOString(),
      },
    })

    database.prepare(
      `INSERT INTO KnowledgeJob (
        id, novelId, branchId, jobType, status, progress, currentStep, payloadJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, 'rewrite_generation', 'running', ?, ?, ?, datetime('now', '-10 seconds'), datetime('now', '-10 seconds'))`
    ).run('rewrite-watchdog-create', 'novel-rewrite', 'novel-rewrite:main', 0.4, '生成中', payloadJson)

    let scheduledRun: Promise<void> | null = null
    const { POST } = await importRewriteRoute({
      afterImpl: (callback) => {
        scheduledRun = callback()
      },
    })

    const response = await POST(createRewriteRequest({ recoverableRewriteJob: true }))
    const data = await response.json() as { ok: boolean; job: { jobId: string; status: string } }

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.job.jobId).toBe('rewrite-watchdog-create')
    expect(data.job.status).toBe('queued')

    await waitForCondition(() => {
      const row = queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', 'rewrite-watchdog-create')
      return row?.status === 'succeeded'
    })
    await scheduledRun

    expect(fetchMock).toHaveBeenCalledTimes(1)
  }, 30000)

  it('rejects stale rewrite runner final updates after watchdog assigns a newer attempt', async () => {
    process.env.RETALE_TASK_STALE_TIMEOUT_MS = '1000'
    process.env.RETALE_TASK_MAX_RETRIES = '1'

    const { database, queryOne } = await createTestDatabase('retale-rewrite-watchdog-attempt-guard')
    const basePayload = {
      request: {
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
      },
      panel: {
        novelId: 'novel-rewrite',
        branchId: 'novel-rewrite:main',
        chapterId: 'chapter-rewrite-1',
        selectedText: '选中文本',
        sourceText: '原始章节正文。',
        sourceTextOverride: null,
        userInstruction: '增强压迫感。',
        rewriteLaunchSource: 'chapter',
        branchContextNodeId: null,
        branchContextInclusion: null,
        continueBlockId: null,
        createdAt: new Date().toISOString(),
      },
      taskWatchdog: {
        attemptId: 'attempt-old',
      },
    }

    database.prepare(
      `INSERT INTO KnowledgeJob (
        id, novelId, branchId, jobType, status, progress, currentStep, payloadJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, 'rewrite_generation', 'running', ?, ?, ?, datetime('now', '-10 seconds'), datetime('now', '-10 seconds'))`
    ).run('rewrite-watchdog-guard', 'novel-rewrite', 'novel-rewrite:main', 0.4, '生成中', JSON.stringify(basePayload))

    const { createNovelDatabaseAccess } = await import('@/lib/server/database-access')
    const scopedDb = createNovelDatabaseAccess('novel-rewrite')
    const { reconcileKnowledgeJobWatchdog } = await import('@/lib/server/knowledge-job-watchdog')
    const { updateRecoverableRewriteJob } = await import('@/lib/server/recoverable-rewrite-jobs')
    reconcileKnowledgeJobWatchdog({
      jobId: 'rewrite-watchdog-guard',
      novelId: 'novel-rewrite',
      jobTypes: ['rewrite_generation'],
      db: scopedDb,
    })

    const queuedRow = queryOne<{ status: string; payloadJson: string | null }>(
      'SELECT status, payloadJson FROM KnowledgeJob WHERE id = ?',
      'rewrite-watchdog-guard',
    )
    const queuedPayload = JSON.parse(queuedRow?.payloadJson ?? '{}') as {
      taskWatchdog?: { attemptId?: string; attemptCount?: number }
      result?: { content?: string }
    }

    expect(queuedRow?.status).toBe('queued')
    expect(queuedPayload.taskWatchdog?.attemptId).not.toBe('attempt-old')

    const staleUpdate = updateRecoverableRewriteJob('rewrite-watchdog-guard', {
      status: 'succeeded',
      progress: 1,
      currentStep: '完成',
      payload: {
        ...basePayload,
        result: {
          provider: 'openai-compatible',
          title: '生成版本',
          summary: 'stale result',
          content: '旧 runner 的结果',
          inputTokens: null,
          outputTokens: null,
          metadata: null,
          presetCompat: null,
        },
      },
      expectedAttemptId: 'attempt-old',
      db: scopedDb,
    })

    const finalRow = queryOne<{ status: string; payloadJson: string | null }>(
      'SELECT status, payloadJson FROM KnowledgeJob WHERE id = ?',
      'rewrite-watchdog-guard',
    )
    const finalPayload = JSON.parse(finalRow?.payloadJson ?? '{}') as {
      taskWatchdog?: { attemptId?: string; attemptCount?: number }
      result?: { content?: string }
    }

    expect(staleUpdate.changes).toBe(0)
    expect(finalRow?.status).toBe('queued')
    expect(finalPayload.taskWatchdog?.attemptId).toBe(queuedPayload.taskWatchdog?.attemptId)
    expect(finalPayload.result).toBeUndefined()
  })

  it('claims a queued job once when multiple runners race', async () => {
    await createTestDatabase('retale-rewrite-claim-once')
    const fetchControl: { resolve: ((response: Response) => void) | null } = { resolve: null }
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      fetchControl.resolve = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET, POST, runRecoverableRewriteJobForTesting } = await importRewriteRoute()
    const createdResponse = await POST(createRewriteRequest({ recoverableRewriteJob: true }))
    const created = await createdResponse.json() as { job: { jobId: string; status: string } }
    expect(created.job.status).toBe('queued')
    const firstRun = runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')
    const secondRun = runRecoverableRewriteJobForTesting(created.job.jobId, 'novel-rewrite')

    await waitForCondition(() => fetchMock.mock.calls.length === 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchControl.resolve?.(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'claimed once result' }) } }],
    }), { status: 200 }))
    await Promise.all([firstRun, secondRun])

    const restoredResponse = await GET(new Request(`http://localhost/api/rewrite?jobId=${created.job.jobId}&novelId=novel-rewrite`))
    const restored = await restoredResponse.json() as { job: { status: string; result: { content: string } } }
    expect(restored.job.status).toBe('succeeded')
    expect(restored.job.result.content).toBe('claimed once result')
  }, 30000)
})
