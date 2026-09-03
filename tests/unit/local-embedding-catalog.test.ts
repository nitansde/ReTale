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
  resolveLocalEmbeddingRuntimeTuning,
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
  it('pins the recommended 4B Qwen GGUF and a curated consumer-hardware catalog', () => {
    const model = getDefaultLocalEmbeddingModel()
    expect(model.id).toBe('qwen3-embedding-4b-q4_k_m')
    expect(model.downloadBytes).toBe(2_496_703_776)
    expect(model.sha256).toBe('2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b')
    expect(model.dimension).toBe(2560)
    expect(model.pooling).toBe('last')
    expect(model.normalization).toBe('l2')
    const publicModels = listPublicLocalEmbeddingModels()
    expect(publicModels).toHaveLength(5)
    expect(publicModels.filter((item) => item.recommended).map((item) => item.id)).toEqual([model.id])
    expect(getLocalEmbeddingModel('qwen3-embedding-8b-q4_k_m')).toMatchObject({
      downloadBytes: 4_676_804_928,
      sha256: '3fcd3febec8b3fd64435204db75bf0dd73b91e8d0661e0331acfe7e7c3120b85',
      dimension: 4096,
      recommended: false,
    })
    expect(getLocalEmbeddingModel('bge-m3-q8_0')).toMatchObject({
      downloadBytes: 634_553_760,
      sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173',
      dimension: 1024,
      pooling: 'cls',
      queryInstruction: null,
    })
    expect(getLocalEmbeddingModel('qwen3-embedding-0.6b-f16')).toMatchObject({
      downloadBytes: 1_197_629_632,
      sha256: '421a27e58d165478cc7acb984a688c2aa41404968b0203e7cd743ece44c54340',
      recommended: false,
    })
    expect(model.downloadUrls.map((url) => new URL(url).host)).toEqual(['huggingface.co', 'hf-mirror.com'])
    expect(publicModels[0]).not.toHaveProperty('downloadUrls')
  })

  it('applies the Qwen retrieval instruction only when explicitly building a query', () => {
    const model = getDefaultLocalEmbeddingModel()
    expect(buildLocalEmbeddingQuery(model.id, ' 谁拿走了钥匙？ ')).toBe(
      'Instruct: Given a query about a novel, retrieve passages, entities, events, and relationships relevant to the query\nQuery: 谁拿走了钥匙？',
    )
    expect(buildLocalEmbeddingQuery('bge-m3-q8_0', ' 谁拿走了钥匙？ ')).toBe('谁拿走了钥匙？')
    expect(buildLocalEmbeddingQuery('external-model', ' 原文段落 ')).toBe('原文段落')
  })

  it('versions the local cache identity with model and embedding semantics', () => {
    const identity = buildLocalEmbeddingCacheIdentity(getDefaultLocalEmbeddingModel().id)
    expect(identity).toContain('sha256:2b0cf8f1')
    expect(identity).toContain('dim:2560')
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
    }, '/safe/model.gguf', 999, 16 * 1024 ** 3)
    expect(args).toContain('--embedding')
    expect(args).toContain('--no-webui')
    expect(args).toContain('--no-cors-credentials')
    expect(args.slice(args.indexOf('--alias'), args.indexOf('--alias') + 2)).toEqual(['--alias', 'qwen3-embedding-4b-q4_k_m'])
    expect(args.slice(args.indexOf('--api-key'), args.indexOf('--api-key') + 2)).toEqual(['--api-key', 'retale-local'])
    expect(args.slice(args.indexOf('--cors-origins'), args.indexOf('--cors-origins') + 2)).toEqual(['--cors-origins', 'localhost'])
    expect(args.slice(args.indexOf('--host'), args.indexOf('--host') + 2)).toEqual(['--host', '127.0.0.1'])
    expect(args.slice(args.indexOf('--parallel'), args.indexOf('--parallel') + 2)).toEqual(['--parallel', '1'])
    expect(args.slice(args.indexOf('--batch-size'), args.indexOf('--batch-size') + 2)).toEqual(['--batch-size', '256'])
    expect(args.slice(args.indexOf('--ubatch-size'), args.indexOf('--ubatch-size') + 2)).toEqual(['--ubatch-size', '128'])

    const customArgs = buildLocalEmbeddingServerArgs(restoreCustomLocalEmbeddingModel(
      'hf-embedding-0123456789abcdef',
      { repository: 'owner/model', fileName: 'embedding.gguf' },
    ), '/safe/custom.gguf', 0)
    expect(customArgs).not.toContain('--pooling')

    const bgeModel = getLocalEmbeddingModel('bge-m3-q8_0')!
    const bgeArgs = buildLocalEmbeddingServerArgs({
      id: bgeModel.id,
      label: bgeModel.label,
      localFileName: bgeModel.fileName,
      contextSize: bgeModel.contextSize,
      pooling: bgeModel.pooling,
      normalization: bgeModel.normalization,
    }, '/safe/bge-m3.gguf', 0)
    expect(bgeArgs.slice(bgeArgs.indexOf('--pooling'), bgeArgs.indexOf('--pooling') + 2)).toEqual(['--pooling', 'cls'])
  })

  it('scales llama-server parallelism and token batches from physical memory', () => {
    expect(resolveLocalEmbeddingRuntimeTuning(8 * 1024 ** 3)).toEqual({
      parallel: 1,
      batchSize: 128,
      microBatchSize: 64,
    })
    expect(resolveLocalEmbeddingRuntimeTuning(16 * 1024 ** 3)).toEqual({
      parallel: 1,
      batchSize: 256,
      microBatchSize: 128,
    })
    expect(resolveLocalEmbeddingRuntimeTuning(64 * 1024 ** 3)).toEqual({
      parallel: 4,
      batchSize: 1024,
      microBatchSize: 512,
    })
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
