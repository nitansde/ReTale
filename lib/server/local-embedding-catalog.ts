import path from 'node:path'
import type { LocalEmbeddingBackend, LocalEmbeddingCatalogModel } from '@/lib/local-embedding'
import { LOCAL_EMBEDDING_BASE_URL } from '@/lib/local-embedding'
import { isCustomLocalEmbeddingModelId } from '@/lib/server/local-embedding-custom-model'

export const LLAMA_CPP_RUNTIME_VERSION = 'b10705'
export const LOCAL_EMBEDDING_QUERY_RECIPE_VERSION = 'qwen3-retrieval-v1'

export type LocalEmbeddingModelDefinition = LocalEmbeddingCatalogModel & {
  repository: string
  fileName: string
  downloadUrls: readonly string[]
  sha256: string
  queryInstruction: string
}

export type LlamaCppRuntimeArtifact = {
  id: string
  platform: NodeJS.Platform
  arch: string
  backend: LocalEmbeddingBackend
  archiveType: 'tar.gz' | 'zip'
  fileName: string
  downloadUrl: string
  sha256: string
  downloadBytes: number
  executableName: string
}

const QWEN3_EMBEDDING_06B_Q8: LocalEmbeddingModelDefinition = {
  id: 'qwen3-embedding-0.6b-q8_0',
  label: 'Qwen3 Embedding 0.6B · Q8_0',
  description: '默认推荐。中英文检索表现均衡，适合小说段落、实体、事件与关系检索。',
  family: 'Qwen3 Embedding 0.6B',
  profile: 'balanced',
  quantization: 'Q8_0',
  license: 'Apache 2.0',
  repository: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
  fileName: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
  downloadUrls: huggingFaceDownloadUrls('Qwen/Qwen3-Embedding-0.6B-GGUF', 'Qwen3-Embedding-0.6B-Q8_0.gguf'),
  sha256: '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
  downloadBytes: 639_150_592,
  dimension: 1024,
  contextSize: 1024,
  pooling: 'last',
  normalization: 'l2',
  memoryMinBytes: 800_000_000,
  memoryMaxBytes: 1_500_000_000,
  diskEstimateBytes: 850_000_000,
  recommended: true,
  queryInstruction: 'Given a query about a novel, retrieve passages, entities, events, and relationships relevant to the query',
}

const QWEN3_EMBEDDING_06B_F16: LocalEmbeddingModelDefinition = {
  ...QWEN3_EMBEDDING_06B_Q8,
  id: 'qwen3-embedding-0.6b-f16',
  label: 'Qwen3 Embedding 0.6B · F16',
  description: '完整 F16 权重，精度优先；下载、磁盘与内存需求约为 Q8_0 的两倍。',
  profile: 'high-precision',
  quantization: 'F16',
  fileName: 'Qwen3-Embedding-0.6B-f16.gguf',
  downloadUrls: huggingFaceDownloadUrls('Qwen/Qwen3-Embedding-0.6B-GGUF', 'Qwen3-Embedding-0.6B-f16.gguf'),
  sha256: '421a27e58d165478cc7acb984a688c2aa41404968b0203e7cd743ece44c54340',
  downloadBytes: 1_197_629_632,
  memoryMinBytes: 1_400_000_000,
  memoryMaxBytes: 2_400_000_000,
  diskEstimateBytes: 1_450_000_000,
  recommended: false,
}

const LOCAL_EMBEDDING_MODELS = [QWEN3_EMBEDDING_06B_Q8, QWEN3_EMBEDDING_06B_F16] as const

const RELEASE_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RUNTIME_VERSION}`

function huggingFaceDownloadUrls(repository: string, fileName: string) {
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/')
  const encodedFileName = encodeURIComponent(fileName)
  const suffix = `${encodedRepository}/resolve/main/${encodedFileName}?download=true`
  return [
    `https://huggingface.co/${suffix}`,
    `https://hf-mirror.com/${suffix}`,
  ] as const
}

const RUNTIME_ARTIFACTS: LlamaCppRuntimeArtifact[] = [
  runtimeArtifact('macos-arm64', 'darwin', 'arm64', 'metal', 'tar.gz', 'llama-b10705-bin-macos-arm64.tar.gz', 'c91e26ec5c5357dfe55f7d2c3b58f9b390244ac0f8c32d87d73c790f8c20bc87', 11_042_155),
  runtimeArtifact('macos-x64', 'darwin', 'x64', 'metal', 'tar.gz', 'llama-b10705-bin-macos-x64.tar.gz', '5ac6716a40a2ecea28ce7405f54161e025b8e7555a189f139dbeb8cd2b0c0b4c', 11_112_798),
  runtimeArtifact('linux-vulkan-arm64', 'linux', 'arm64', 'vulkan', 'tar.gz', 'llama-b10705-bin-ubuntu-vulkan-arm64.tar.gz', '86805e7c33cbc7433be91e97c612f4c86d87580aaeb97d56ecf59da403a8ac48', 27_300_378),
  runtimeArtifact('linux-vulkan-x64', 'linux', 'x64', 'vulkan', 'tar.gz', 'llama-b10705-bin-ubuntu-vulkan-x64.tar.gz', 'b7c484440024dceaa9f53c4d1e5c0c918476a975c1f898939c1915d2efb6e068', 33_478_848),
  runtimeArtifact('linux-cpu-arm64', 'linux', 'arm64', 'cpu', 'tar.gz', 'llama-b10705-bin-ubuntu-arm64.tar.gz', '6f2c96177fbf39ae3be16211a2c3cbe5476fd8b8345a2316437350ff1e3424c4', 13_163_005),
  runtimeArtifact('linux-cpu-x64', 'linux', 'x64', 'cpu', 'tar.gz', 'llama-b10705-bin-ubuntu-x64.tar.gz', '12fa9a50893f7082c8f6f6d5f76506bbe602b67578a917fd80542a168ac3b0a8', 16_417_793),
  runtimeArtifact('windows-vulkan-x64', 'win32', 'x64', 'vulkan', 'zip', 'llama-b10705-bin-win-vulkan-x64.zip', '7e437f65cd4997141a7ed06291f59f1a0e928588e25c95fb7fac5f4742c05ce0', 34_917_988),
  runtimeArtifact('windows-cpu-x64', 'win32', 'x64', 'cpu', 'zip', 'llama-b10705-bin-win-cpu-x64.zip', '2936e7e033a56dc8e17816234ea82979cc92f144eacadd1cee31f3b42e6b8077', 18_147_056),
  runtimeArtifact('windows-cpu-arm64', 'win32', 'arm64', 'cpu', 'zip', 'llama-b10705-bin-win-cpu-arm64.zip', 'b823e78777eef493b89bd0c3f6bced5e4b5d8724629fde572fcaf978db49f102', 11_918_255),
]

function runtimeArtifact(
  id: string,
  platform: NodeJS.Platform,
  arch: string,
  backend: LocalEmbeddingBackend,
  archiveType: 'tar.gz' | 'zip',
  fileName: string,
  sha256: string,
  downloadBytes: number,
): LlamaCppRuntimeArtifact {
  return {
    id,
    platform,
    arch,
    backend,
    archiveType,
    fileName,
    downloadUrl: `${RELEASE_BASE}/${fileName}`,
    sha256,
    downloadBytes,
    executableName: platform === 'win32' ? 'llama-server.exe' : 'llama-server',
  }
}

export function listLocalEmbeddingModels(): LocalEmbeddingModelDefinition[] {
  return LOCAL_EMBEDDING_MODELS.map((model) => ({ ...model }))
}

export function listPublicLocalEmbeddingModels(): LocalEmbeddingCatalogModel[] {
  return LOCAL_EMBEDDING_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    description: model.description,
    family: model.family,
    profile: model.profile,
    quantization: model.quantization,
    license: model.license,
    downloadBytes: model.downloadBytes,
    dimension: model.dimension,
    contextSize: model.contextSize,
    pooling: model.pooling,
    normalization: model.normalization,
    memoryMinBytes: model.memoryMinBytes,
    memoryMaxBytes: model.memoryMaxBytes,
    diskEstimateBytes: model.diskEstimateBytes,
    recommended: model.recommended,
  }))
}

export function getLocalEmbeddingModel(modelId: string) {
  return LOCAL_EMBEDDING_MODELS.find((model) => model.id === modelId) ?? null
}

export function getDefaultLocalEmbeddingModel() {
  return QWEN3_EMBEDDING_06B_Q8
}

export function getLlamaCppRuntimeArtifact(params: {
  platform?: NodeJS.Platform
  arch?: string
  backend: LocalEmbeddingBackend
}) {
  const platform = params.platform ?? process.platform
  const arch = params.arch ?? process.arch
  return RUNTIME_ARTIFACTS.find((artifact) => (
    artifact.platform === platform
    && artifact.arch === arch
    && artifact.backend === params.backend
  )) ?? null
}

export function getLlamaCppRuntimeArtifactById(artifactId: string) {
  return RUNTIME_ARTIFACTS.find((artifact) => artifact.id === artifactId) ?? null
}

export function getSupportedRuntimeBackends(platform: NodeJS.Platform = process.platform, arch: string = process.arch) {
  return RUNTIME_ARTIFACTS
    .filter((artifact) => artifact.platform === platform && artifact.arch === arch)
    .map((artifact) => artifact.backend)
}

export function buildLocalEmbeddingQuery(modelId: string, query: string) {
  const model = getLocalEmbeddingModel(modelId)
  const normalized = query.trim()
  if (!model || !normalized) return normalized
  return `Instruct: ${model.queryInstruction}\nQuery: ${normalized}`
}

export function buildLocalEmbeddingCacheIdentity(modelId: string) {
  const model = getLocalEmbeddingModel(modelId)
  if (!model) return modelId
  return [
    model.id,
    `sha256:${model.sha256}`,
    `dim:${model.dimension}`,
    `pool:${model.pooling}`,
    `norm:${model.normalization}`,
    `query:${LOCAL_EMBEDDING_QUERY_RECIPE_VERSION}`,
  ].join('|')
}

export function isRetaleLocalEmbeddingConfig(baseUrl: string, modelId: string) {
  const normalize = (value: string) => value.trim().replace(/\/+$/u, '')
  return normalize(baseUrl) === normalize(LOCAL_EMBEDDING_BASE_URL)
    && (Boolean(getLocalEmbeddingModel(modelId)) || isCustomLocalEmbeddingModelId(modelId))
}

export function assertSafeCatalogFileName(fileName: string) {
  if (!fileName || fileName !== path.basename(fileName) || fileName === '.' || fileName === '..') {
    throw new Error('Local embedding catalog contains an unsafe file name')
  }
  return fileName
}
