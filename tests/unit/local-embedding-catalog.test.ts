import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildLocalEmbeddingCacheIdentity,
  buildLocalEmbeddingQuery,
  getDefaultLocalEmbeddingModel,
  getLlamaCppRuntimeArtifact,
  getLocalEmbeddingModel,
  isRetaleLocalEmbeddingConfig,
  listPublicLocalEmbeddingModels,
} from '@/lib/server/local-embedding-catalog'
import { LOCAL_EMBEDDING_BASE_URL } from '@/lib/local-embedding'
import {
  assertAllowedHuggingFaceDownloadUrl,
  buildHuggingFaceCustomModelDownloadUrls,
  normalizeHuggingFaceCustomModelReference,
  restoreCustomLocalEmbeddingModel,
} from '@/lib/server/local-embedding-custom-model'
import {
  buildLocalEmbeddingLaunchAttempts,
  buildLocalEmbeddingServerArgs,
  downloadUnverifiedModelFile,
  downloadVerifiedFile,
  findExtractedRuntimeSourcePath,
  resolveLocalEmbeddingPaths,
  resetLocalEmbeddingRuntimeForTests,
} from '@/lib/server/local-embedding-runtime'

const temporaryPaths: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  resetLocalEmbeddingRuntimeForTests()
  await Promise.all(temporaryPaths.splice(0).map((temporaryPath) => fs.rm(temporaryPath, { recursive: true, force: true })))
})

describe('local embedding catalog', () => {
  it('pins the recommended Qwen GGUF and its vector contract', () => {
    const model = getDefaultLocalEmbeddingModel()
    expect(model.id).toBe('qwen3-embedding-0.6b-q8_0')
    expect(model.downloadBytes).toBe(639_150_592)
    expect(model.sha256).toBe('06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439')
    expect(model.dimension).toBe(1024)
    expect(model.pooling).toBe('last')
    expect(model.normalization).toBe('l2')
    expect(listPublicLocalEmbeddingModels()).toHaveLength(2)
    expect(getLocalEmbeddingModel('qwen3-embedding-0.6b-f16')).toMatchObject({
      downloadBytes: 1_197_629_632,
      sha256: '421a27e58d165478cc7acb984a688c2aa41404968b0203e7cd743ece44c54340',
      recommended: false,
    })
    expect(model.downloadUrls.map((url) => new URL(url).host)).toEqual(['huggingface.co', 'hf-mirror.com'])
    expect(listPublicLocalEmbeddingModels()[0]).not.toHaveProperty('downloadUrls')
  })

  it('applies the Qwen retrieval instruction only when explicitly building a query', () => {
    const model = getDefaultLocalEmbeddingModel()
    expect(buildLocalEmbeddingQuery(model.id, ' 谁拿走了钥匙？ ')).toBe(
      'Instruct: Given a query about a novel, retrieve passages, entities, events, and relationships relevant to the query\nQuery: 谁拿走了钥匙？',
    )
    expect(buildLocalEmbeddingQuery('external-model', ' 原文段落 ')).toBe('原文段落')
  })

  it('versions the local cache identity with model and embedding semantics', () => {
    const identity = buildLocalEmbeddingCacheIdentity(getDefaultLocalEmbeddingModel().id)
    expect(identity).toContain('sha256:06507c7b')
    expect(identity).toContain('dim:1024')
    expect(identity).toContain('pool:last')
    expect(identity).toContain('norm:l2')
    expect(identity).toContain('query:qwen3-retrieval-v1')
  })

  it('recognizes only the fixed Retale loopback endpoint and catalog models', () => {
    const modelId = getDefaultLocalEmbeddingModel().id
    expect(isRetaleLocalEmbeddingConfig(`${LOCAL_EMBEDDING_BASE_URL}/`, modelId)).toBe(true)
    expect(isRetaleLocalEmbeddingConfig('http://127.0.0.1:9999/v1', modelId)).toBe(false)
    expect(isRetaleLocalEmbeddingConfig(LOCAL_EMBEDDING_BASE_URL, 'unknown')).toBe(false)
    expect(isRetaleLocalEmbeddingConfig(LOCAL_EMBEDDING_BASE_URL, 'hf-embedding-0123456789abcdef')).toBe(true)
    expect(getLocalEmbeddingModel('unknown')).toBeNull()
  })

  it('builds custom downloads from only the two allowlisted Hugging Face hosts', () => {
    const urls = buildHuggingFaceCustomModelDownloadUrls({
      repository: 'owner/embedding-model',
      fileName: 'quantized/model Q8.gguf',
    })
    expect(urls.map((url) => new URL(url).host)).toEqual(['huggingface.co', 'hf-mirror.com'])
    expect(urls[0]).toContain('/owner/embedding-model/resolve/main/quantized/model%20Q8.gguf')
    expect(() => normalizeHuggingFaceCustomModelReference({
      repository: 'https://evil.example/model',
      fileName: 'payload.gguf',
    })).toThrow('owner/model')
    expect(() => normalizeHuggingFaceCustomModelReference({
      repository: 'owner/model',
      fileName: '../payload.gguf',
    })).toThrow('safe .gguf path')
    expect(() => assertAllowedHuggingFaceDownloadUrl('https://evil.example/model.gguf')).toThrow('only be downloaded')
  })

  it('keeps resolved paths catalog-bound and rejects unknown IDs', () => {
    const artifact = getLlamaCppRuntimeArtifact({ platform: 'darwin', arch: 'arm64', backend: 'metal' })
    expect(artifact).not.toBeNull()
    const paths = resolveLocalEmbeddingPaths(getDefaultLocalEmbeddingModel().id, artifact!.id)
    expect(paths.modelPath.startsWith(paths.rootPath)).toBe(true)
    expect(paths.runtimeExecutablePath.startsWith(paths.rootPath)).toBe(true)
    expect(() => resolveLocalEmbeddingPaths('../outside', artifact!.id)).toThrow('Unknown local embedding model')
    expect(() => resolveLocalEmbeddingPaths(getDefaultLocalEmbeddingModel().id, '../outside')).toThrow('Unsupported llama.cpp runtime artifact')
  })

  it('orders accelerated startup before deterministic CPU fallback', () => {
    expect(buildLocalEmbeddingLaunchAttempts('metal')).toEqual([
      { backend: 'metal', gpuLayers: 999, useCpuRuntime: false },
      { backend: 'cpu', gpuLayers: 0, useCpuRuntime: false },
    ])
    expect(buildLocalEmbeddingLaunchAttempts('vulkan')).toEqual([
      { backend: 'vulkan', gpuLayers: 999, useCpuRuntime: false },
      { backend: 'cpu', gpuLayers: 0, useCpuRuntime: false },
      { backend: 'cpu', gpuLayers: 0, useCpuRuntime: true },
    ])
  })

  it('binds llama-server to loopback with a fixed alias and API key', () => {
    const catalogModel = getDefaultLocalEmbeddingModel()
    const args = buildLocalEmbeddingServerArgs({
      id: catalogModel.id,
      label: catalogModel.label,
      localFileName: catalogModel.fileName,
      contextSize: catalogModel.contextSize,
      pooling: catalogModel.pooling,
      normalization: catalogModel.normalization,
    }, '/safe/model.gguf', 999)
    expect(args).toContain('--embedding')
    expect(args).toContain('--no-webui')
    expect(args).toContain('--no-cors-credentials')
    expect(args.slice(args.indexOf('--alias'), args.indexOf('--alias') + 2)).toEqual(['--alias', 'qwen3-embedding-0.6b-q8_0'])
    expect(args.slice(args.indexOf('--api-key'), args.indexOf('--api-key') + 2)).toEqual(['--api-key', 'retale-local'])
    expect(args.slice(args.indexOf('--cors-origins'), args.indexOf('--cors-origins') + 2)).toEqual(['--cors-origins', 'localhost'])
    expect(args.slice(args.indexOf('--host'), args.indexOf('--host') + 2)).toEqual(['--host', '127.0.0.1'])

    const customArgs = buildLocalEmbeddingServerArgs(restoreCustomLocalEmbeddingModel(
      'hf-embedding-0123456789abcdef',
      { repository: 'owner/model', fileName: 'embedding.gguf' },
    ), '/safe/custom.gguf', 0)
    expect(customArgs).not.toContain('--pooling')
  })

  it('accepts both tar directory and flat Windows zip runtime layouts', async () => {
    const testRoot = process.env.RETALE_TEST_ROOT
    expect(testRoot).toBeTruthy()
    const temporaryPath = await fs.mkdtemp(path.join(testRoot!, 'local-embedding-layout-'))
    temporaryPaths.push(temporaryPath)

    const flatPath = path.join(temporaryPath, 'flat')
    await fs.mkdir(flatPath)
    await fs.writeFile(path.join(flatPath, 'llama-server.exe'), '')
    await expect(findExtractedRuntimeSourcePath(flatPath, 'llama-server.exe')).resolves.toBe(flatPath)

    const nestedPath = path.join(temporaryPath, 'nested')
    const releasePath = path.join(nestedPath, 'llama-b10705')
    await fs.mkdir(releasePath, { recursive: true })
    await fs.writeFile(path.join(releasePath, 'llama-server'), '')
    await expect(findExtractedRuntimeSourcePath(nestedPath, 'llama-server')).resolves.toBe(releasePath)
  })

  it('falls back to hf-mirror and resumes a verified partial download', async () => {
    const testRoot = process.env.RETALE_TEST_ROOT
    expect(testRoot).toBeTruthy()
    const temporaryPath = await fs.mkdtemp(path.join(testRoot!, 'local-embedding-verified-download-'))
    temporaryPaths.push(temporaryPath)
    const destinationPath = path.join(temporaryPath, 'model.gguf')
    const content = Buffer.from('GGUFverified-content')
    await fs.writeFile(`${destinationPath}.partial`, content.subarray(0, 7))
    const sha256 = (await import('node:crypto')).createHash('sha256').update(content).digest('hex')
    const requests: Array<{ url: string; range: string | null }> = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const range = new Headers(init?.headers).get('range')
      requests.push({ url, range })
      if (url.includes('huggingface.co')) return new Response('blocked', { status: 503 })
      return new Response(content.subarray(7), {
        status: 206,
        headers: {
          'Content-Length': String(content.length - 7),
          'Content-Range': `bytes 7-${content.length - 1}/${content.length}`,
        },
      })
    })

    await downloadVerifiedFile({
      kind: 'model',
      urls: ['https://huggingface.co/owner/model.gguf', 'https://hf-mirror.com/owner/model.gguf'],
      expectedBytes: content.length,
      sha256,
      destinationPath,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests).toEqual([
      { url: 'https://huggingface.co/owner/model.gguf', range: 'bytes=7-' },
      { url: 'https://hf-mirror.com/owner/model.gguf', range: 'bytes=7-' },
    ])
    await expect(fs.readFile(destinationPath)).resolves.toEqual(content)
  })

  it('downloads a custom GGUF without a checksum while still rejecting non-GGUF data', async () => {
    const testRoot = process.env.RETALE_TEST_ROOT
    expect(testRoot).toBeTruthy()
    const temporaryPath = await fs.mkdtemp(path.join(testRoot!, 'local-embedding-custom-download-'))
    temporaryPaths.push(temporaryPath)
    const destinationPath = path.join(temporaryPath, 'custom.gguf')
    const content = Buffer.from('GGUFcustom-content-without-a-known-checksum')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('blocked', { status: 503 }))
      .mockResolvedValueOnce(new Response(content, {
        status: 200,
        headers: { 'Content-Length': String(content.length) },
      }))

    await downloadUnverifiedModelFile({
      urls: ['https://huggingface.co/owner/model.gguf', 'https://hf-mirror.com/owner/model.gguf'],
      destinationPath,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(fs.readFile(destinationPath)).resolves.toEqual(content)

    const invalidDestination = path.join(temporaryPath, 'invalid.gguf')
    fetchMock.mockResolvedValueOnce(new Response('not-a-gguf', {
      status: 200,
      headers: { 'Content-Length': '10' },
    }))
    await expect(downloadUnverifiedModelFile({
      urls: ['https://hf-mirror.com/owner/invalid.gguf'],
      destinationPath: invalidDestination,
    })).rejects.toThrow('not a valid GGUF')

    const truncatedDestination = path.join(temporaryPath, 'truncated.gguf')
    fetchMock.mockResolvedValueOnce(new Response('GGUFshort', {
      status: 200,
      headers: { 'Content-Length': '20' },
    }))
    await expect(downloadUnverifiedModelFile({
      urls: ['https://hf-mirror.com/owner/truncated.gguf'],
      destinationPath: truncatedDestination,
    })).rejects.toThrow('size mismatch')
  })
})
