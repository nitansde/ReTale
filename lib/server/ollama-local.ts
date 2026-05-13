import type { ChapterKnowledgeExtraction, KnowledgeEvidence } from '@/lib/story-knowledge'
import { findAppSettings } from '@/lib/server/persistence'

type OllamaTagsResponse = {
  models?: Array<{
    name?: string
    model?: string
    modified_at?: string
    size?: number
    details?: {
      family?: string
      parameter_size?: string
      quantization_level?: string
    }
  }>
}

type OllamaShowResponse = {
  capabilities?: string[]
}

type OllamaChatResponse = {
  message?: {
    content?: string
  }
}

type OllamaConfig = {
  baseUrl: string
  model: string | null
  timeoutMs: number
  enabled: boolean
  reason?: string
}

export type OllamaExtractionResult = {
  enabled: boolean
  extraction?: ChapterKnowledgeExtraction
  model?: string
  error?: string
}

type OllamaRewriteRequest = {
  sourceText: string
  mode: string
  tone: string
  scope: string
  prompt: string
  keepCanon: boolean
  autoContinue: boolean
  thoughtLevel: string
}

type OllamaRewriteResult = {
  enabled: boolean
  content?: string[]
  error?: string
}

type OllamaStreamRewriteRequest = {
  systemPrompt: string
  userPrompt: string
  temperature?: number
}

type OllamaStreamRewriteResult = {
  enabled: boolean
  stream?: ReadableStream<Uint8Array>
  error?: string
}

export type OllamaModelOption = {
  id: string
  label: string
  family?: string
  parameterSize?: string
  quantization?: string
  sizeBytes?: number
  modifiedAt?: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_TIMEOUT_MS = 600000
const EXTRACTION_TOP_LEVEL_ARRAY_KEYS = ['relations', 'events', 'worldbuilding', 'open_threads'] as const
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    chapter_no: { type: 'integer' },
    summary: { type: 'string' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          status: { type: 'string' },
          description_delta: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['name', 'aliases', 'status', 'description_delta', 'evidence'],
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          type: { type: 'string' },
          polarity: { type: 'string' },
          strength: { type: 'integer' },
          change: { type: 'string' },
          valid_from_chapter: { type: 'integer' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['source', 'target', 'type', 'polarity', 'strength', 'change', 'valid_from_chapter', 'evidence'],
      },
    },
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          event_type: { type: 'string' },
          participants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
              },
              required: ['name', 'role'],
            },
          },
          consequences: { type: 'string' },
          importance: { type: 'integer' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['name', 'summary', 'event_type', 'participants', 'consequences', 'importance', 'evidence'],
      },
    },
    worldbuilding: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          category: { type: 'string' },
          definition: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['term', 'category', 'definition', 'evidence'],
      },
    },
    open_threads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['name', 'description', 'evidence'],
      },
    },
  },
  required: ['chapter_no', 'summary', 'characters', 'relations', 'events', 'worldbuilding', 'open_threads'],
} as const

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeEvidence(raw: unknown): KnowledgeEvidence[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const quote = typeof record.quote === 'string' ? record.quote.trim() : ''
      const lineStart = Number(record.line_start ?? record.lineStart)
      const lineEnd = Number(record.line_end ?? record.lineEnd ?? lineStart)
      if (!quote || !Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null
      return {
        quote,
        lineStart: Math.max(1, Math.trunc(lineStart)),
        lineEnd: Math.max(Math.trunc(lineStart), Math.trunc(lineEnd)),
      }
    })
    .filter((item): item is KnowledgeEvidence => Boolean(item))
}

function normalizeExtraction(raw: unknown, chapterNo: number): ChapterKnowledgeExtraction {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const openThreadsRaw = record.open_threads ?? record.openThreads
  return {
    chapterNo,
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
    characters: Array.isArray(record.characters)
      ? record.characters
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const name = typeof row.name === 'string' ? row.name.trim() : ''
            if (!name) return null
            return {
              name,
              aliases: Array.isArray(row.aliases) ? row.aliases.map((alias) => String(alias).trim()).filter(Boolean) : [],
              status: typeof row.status === 'string' ? row.status.trim() : '活跃',
              descriptionDelta: typeof row.description_delta === 'string'
                ? row.description_delta.trim()
                : typeof row.descriptionDelta === 'string'
                  ? row.descriptionDelta.trim()
                  : '',
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['characters'][number] => Boolean(item))
      : [],
    relations: Array.isArray(record.relations)
      ? record.relations
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const source = typeof row.source === 'string' ? row.source.trim() : ''
            const target = typeof row.target === 'string' ? row.target.trim() : ''
            if (!source || !target) return null
            const polarity = typeof row.polarity === 'string' ? row.polarity : 'neutral'
            return {
              source,
              target,
              type: typeof row.type === 'string' ? row.type.trim() : '关系',
              polarity: ['positive', 'negative', 'neutral', 'mixed'].includes(polarity) ? polarity as 'positive' | 'negative' | 'neutral' | 'mixed' : 'neutral',
              strength: Number.isFinite(Number(row.strength)) ? Math.max(1, Math.min(5, Math.trunc(Number(row.strength)))) : 3,
              change: typeof row.change === 'string' ? row.change.trim() : '',
              validFromChapter: Number.isFinite(Number(row.valid_from_chapter ?? row.validFromChapter))
                ? Math.max(1, Math.trunc(Number(row.valid_from_chapter ?? row.validFromChapter)))
                : chapterNo,
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['relations'][number] => Boolean(item))
      : [],
    events: Array.isArray(record.events)
      ? record.events
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const name = typeof row.name === 'string' ? row.name.trim() : ''
            if (!name) return null
            const participants = Array.isArray(row.participants)
              ? row.participants
                  .map((participant) => {
                    if (!participant || typeof participant !== 'object') return null
                    const entry = participant as Record<string, unknown>
                    const participantName = typeof entry.name === 'string' ? entry.name.trim() : ''
                    if (!participantName) return null
                    return {
                      name: participantName,
                      role: typeof entry.role === 'string' ? entry.role.trim() : '参与者',
                    }
                  })
                  .filter((entry): entry is { name: string; role: string } => Boolean(entry))
              : []
            return {
              name,
              summary: typeof row.summary === 'string' ? row.summary.trim() : '',
              eventType: typeof row.event_type === 'string'
                ? row.event_type.trim()
                : typeof row.eventType === 'string'
                  ? row.eventType.trim()
                  : 'story',
              participants,
              consequences: typeof row.consequences === 'string' ? row.consequences.trim() : '',
              importance: Number.isFinite(Number(row.importance)) ? Math.max(1, Math.min(5, Math.trunc(Number(row.importance)))) : 3,
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['events'][number] => Boolean(item))
      : [],
    worldbuilding: Array.isArray(record.worldbuilding)
      ? record.worldbuilding
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const term = typeof row.term === 'string' ? row.term.trim() : ''
            if (!term) return null
            return {
              term,
              category: typeof row.category === 'string' ? row.category.trim() : 'concept',
              definition: typeof row.definition === 'string' ? row.definition.trim() : '',
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['worldbuilding'][number] => Boolean(item))
      : [],
    openThreads: Array.isArray(openThreadsRaw)
      ? openThreadsRaw
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const name = typeof row.name === 'string' ? row.name.trim() : ''
            if (!name) return null
            return {
              name,
              description: typeof row.description === 'string' ? row.description.trim() : '',
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['openThreads'][number] => Boolean(item))
      : [],
  }
}

function getStoredOllamaSettings() {
  const entries = findAppSettings([
    'OLLAMA_BASE_URL',
    'OLLAMA_REWRITE_MODEL',
    'OLLAMA_MODEL',
    'OLLAMA_EMBEDDING_MODEL',
    'OLLAMA_TIMEOUT_MS',
  ])
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value]))
  return {
    baseUrl: map.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL,
    rewriteModel: (map.OLLAMA_REWRITE_MODEL ?? process.env.OLLAMA_REWRITE_MODEL ?? '').trim(),
    model: (map.OLLAMA_MODEL ?? process.env.OLLAMA_MODEL ?? '').trim(),
    embeddingModel: (map.OLLAMA_EMBEDDING_MODEL ?? process.env.OLLAMA_EMBEDDING_MODEL ?? '').trim(),
    timeoutMs: parsePositiveInt(map.OLLAMA_TIMEOUT_MS ?? process.env.OLLAMA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  }
}

async function fetchOllamaTags(baseUrl: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { cache: 'no-store' })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  return await response.json() as OllamaTagsResponse
}

async function fetchOllamaCapabilities(baseUrl: string, model: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    cache: 'no-store',
  })

  if (!response.ok) {
    return [] as string[]
  }

  const data = await response.json() as OllamaShowResponse
  return data.capabilities ?? []
}

async function listAvailableOllamaModels(
  baseUrlOverride?: string,
  purpose: 'text' | 'embedding' = 'text'
): Promise<{ baseUrl: string; models: OllamaModelOption[] }> {
  const stored = getStoredOllamaSettings()
  const baseUrl = (baseUrlOverride?.trim() || stored.baseUrl).replace(/\/$/, '')
  const tags = await fetchOllamaTags(baseUrl)
  const candidates = (tags.models ?? [])
    .map((item) => ({
      id: (item.model ?? item.name ?? '').trim(),
      name: (item.name ?? item.model ?? '').trim(),
      modifiedAt: item.modified_at,
      sizeBytes: item.size,
      family: item.details?.family,
      parameterSize: item.details?.parameter_size,
      quantization: item.details?.quantization_level,
    }))
    .filter((item) => item.id)

  const capabilityResults = await Promise.all(
    candidates.map(async (item) => ({
      item,
      capabilities: await fetchOllamaCapabilities(baseUrl, item.id),
    }))
  )

  const models = capabilityResults
    .filter(({ item, capabilities }) => {
      if (capabilities.length > 0) {
        return purpose === 'embedding'
          ? capabilities.includes('embedding')
          : capabilities.includes('completion')
      }
      return purpose === 'embedding' ? /embed/i.test(item.id) : !/embed/i.test(item.id)
    })
    .map(({ item }) => ({
      id: item.id,
      label: [item.name, [item.parameterSize, item.quantization].filter(Boolean).join(' · ')].filter(Boolean).join(' — '),
      family: item.family,
      parameterSize: item.parameterSize,
      quantization: item.quantization,
      sizeBytes: item.sizeBytes,
      modifiedAt: item.modifiedAt,
    }))

  return { baseUrl, models }
}

export async function listAvailableOllamaTextModels(baseUrlOverride?: string): Promise<{ baseUrl: string; models: OllamaModelOption[] }> {
  return listAvailableOllamaModels(baseUrlOverride, 'text')
}

export async function listAvailableOllamaEmbeddingModels(baseUrlOverride?: string): Promise<{ baseUrl: string; models: OllamaModelOption[] }> {
  return listAvailableOllamaModels(baseUrlOverride, 'embedding')
}

async function resolveOllamaTextConfig(configuredModel: string | null | undefined, emptyReason: string): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings()
  const baseUrl = stored.baseUrl
  const timeoutMs = stored.timeoutMs

  let detectedModels: string[] = []
  try {
    const data = await fetchOllamaTags(baseUrl)
    detectedModels = (data.models ?? []).map((item) => (item.model ?? item.name ?? '').trim()).filter(Boolean)
  } catch {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: 'Ollama local server is not reachable',
    }
  }

  const preferredModel = configuredModel || detectedModels.find((name) => !/embed/i.test(name)) || null
  if (!preferredModel) {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: emptyReason,
    }
  }

  if (/embed/i.test(preferredModel)) {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: `Configured Ollama model '${preferredModel}' is an embedding model`,
    }
  }

  return {
    baseUrl,
    model: preferredModel,
    timeoutMs,
    enabled: true,
  }
}

async function getOllamaExtractionConfig(): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings()
  return resolveOllamaTextConfig(stored.model, 'No local Ollama text generation model found')
}

async function getOllamaRewriteConfig(): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings()
  return resolveOllamaTextConfig(stored.rewriteModel, 'No local Ollama rewrite model found')
}

function buildPrompt(chapterTitle: string, chapterNo: number, rawText: string) {
  const numberedLines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')

  return [
    `你是本地小说知识抽取器。请只基于第 ${chapterNo} 章内容抽取结构化知识。`,
    '只返回 JSON。不要解释。不要输出 markdown。',
    '如果不确定，就返回空数组，不要编造。',
    '所有 evidence 都必须引用原文，并带上 line_start 与 line_end。',
    `章节标题：${chapterTitle}`,
    '输出 JSON 结构：',
    JSON.stringify(EXTRACTION_SCHEMA),
    '章节正文（带行号）：',
    numberedLines,
  ].join('\n\n')
}

function extractJsonCandidate(content: string) {
  const trimmed = content.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]?.trim()) {
    return fencedMatch[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim()
  }

  return trimmed
}

function getJsonStructureStack(content: string, limit = content.length) {
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false

  for (let index = 0; index < Math.min(limit, content.length); index += 1) {
    const char = content[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }

    if (char === '}' && stack.at(-1) === '{') {
      stack.pop()
      continue
    }

    if (char === ']' && stack.at(-1) === '[') {
      stack.pop()
    }
  }

  return stack
}

function closeContainers(chars: Array<'{' | '['>) {
  return chars
    .slice()
    .reverse()
    .map((char) => (char === '{' ? '}' : ']'))
    .join('')
}

function repairMismatchedClosers(content: string) {
  let repaired = ''
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false

  for (const char of content) {
    if (inString) {
      repaired += char
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      repaired += char
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      repaired += char
      continue
    }

    if (char === '}' || char === ']') {
      const expectedOpen = char === '}' ? '{' : '['
      while (stack.length > 0 && stack.at(-1) !== expectedOpen) {
        const current = stack.pop()
        repaired += current === '{' ? '}' : ']'
      }

      if (stack.at(-1) === expectedOpen) {
        stack.pop()
      }

      repaired += char
      continue
    }

    repaired += char
  }

  return repaired
}

function repairTopLevelBoundaries(content: string) {
  let repaired = content

  for (const key of EXTRACTION_TOP_LEVEL_ARRAY_KEYS) {
    const marker = `,\"${key}\":`
    const markerIndex = repaired.indexOf(marker)
    if (markerIndex < 0) continue

    const stack = getJsonStructureStack(repaired, markerIndex)
    if (stack.length <= 1) continue

    repaired = `${repaired.slice(0, markerIndex)}${closeContainers(stack.slice(1))}${repaired.slice(markerIndex)}`
  }

  return repaired
}

function parseStructuredContent(content: string) {
  const candidate = extractJsonCandidate(content)

  try {
    return JSON.parse(candidate)
  } catch (initialError) {
    const boundaryRepaired = repairTopLevelBoundaries(candidate)
    const closerRepaired = repairMismatchedClosers(boundaryRepaired)
    const completed = `${closerRepaired}${closeContainers(getJsonStructureStack(closerRepaired))}`
    if (completed !== candidate) {
      return JSON.parse(completed)
    }
    throw initialError
  }
}

async function requestStructuredExtraction(params: {
  baseUrl: string
  model: string
  prompt: string
  timeoutMs: number
  repairMessage?: string
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        think: false,
        format: EXTRACTION_SCHEMA,
        keep_alive: '5m',
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: 'You extract structured chapter knowledge and return valid JSON only.',
          },
          {
            role: 'user',
            content: params.repairMessage ? `${params.prompt}\n\n修复要求：${params.repairMessage}` : params.prompt,
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 400)}`)
    }

    return await response.json() as OllamaChatResponse
  } finally {
    clearTimeout(timeout)
  }
}

async function requestStructuredRepair(params: {
  baseUrl: string
  model: string
  invalidContent: string
  timeoutMs: number
  errorMessage: string
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        think: false,
        format: EXTRACTION_SCHEMA,
        keep_alive: '5m',
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: 'You repair malformed JSON into valid JSON that matches the provided schema. Do not add commentary or markdown.',
          },
          {
            role: 'user',
            content: [
              '下面是一段本地模型生成的无效 JSON，请只修复 JSON 结构问题。',
              '不要补充原文中不存在的事实，不要输出解释。',
              `解析错误：${params.errorMessage}`,
              '目标 JSON Schema：',
              JSON.stringify(EXTRACTION_SCHEMA),
              '无效 JSON：',
              params.invalidContent,
            ].join('\n\n'),
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 400)}`)
    }

    return await response.json() as OllamaChatResponse
  } finally {
    clearTimeout(timeout)
  }
}

export async function extractChapterKnowledgeWithOllama(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
}): Promise<OllamaExtractionResult> {
  const config = await getOllamaExtractionConfig()
  if (!config.enabled || !config.model) {
    return {
      enabled: false,
      error: config.reason ?? 'Ollama extraction disabled',
    }
  }

  const prompt = buildPrompt(params.chapterTitle, params.chapterNo, params.rawText)
  let lastError = 'Failed to parse Ollama JSON'
  let lastContent = ''

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = attempt === 0
        ? await requestStructuredExtraction({
            baseUrl: config.baseUrl,
            model: config.model,
            prompt,
            timeoutMs: config.timeoutMs,
          })
        : await requestStructuredRepair({
            baseUrl: config.baseUrl,
            model: config.model,
            invalidContent: lastContent,
            timeoutMs: config.timeoutMs,
            errorMessage: lastError,
          })

      const content = response.message?.content?.trim() ?? ''
      lastContent = content
      if (!content) {
        lastError = 'Ollama returned empty content'
        continue
      }

      const parsed = parseStructuredContent(content)
      return {
        enabled: true,
        model: config.model,
        extraction: normalizeExtraction(parsed, params.chapterNo),
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Ollama extraction failed'
      if (lastContent) {
        console.error('Ollama JSON parse failed', {
          chapterTitle: params.chapterTitle,
          chapterNo: params.chapterNo,
          model: config.model,
          error: lastError,
          rawOutput: lastContent,
        })
      }
    }
  }

  return {
    enabled: true,
    model: config.model,
    error: lastError,
  }
}

function chunkTextStream(text: string) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const chunks = text.split(/(。|！|？|\n)/).filter(Boolean)
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

async function requestOllamaChat(params: {
  baseUrl: string
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  timeoutMs: number
  temperature?: number
  format?: unknown
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        think: false,
        keep_alive: '5m',
        format: params.format,
        options: {
          temperature: params.temperature ?? 0.7,
        },
        messages: params.messages,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 400)}`)
    }

    return await response.json() as OllamaChatResponse
  } finally {
    clearTimeout(timeout)
  }
}

export async function generateRewriteWithOllama(input: OllamaRewriteRequest): Promise<OllamaRewriteResult> {
  const config = await getOllamaRewriteConfig()
  if (!config.enabled || !config.model) {
    return { enabled: false, error: config.reason ?? 'Ollama rewrite config not set' }
  }

  const user = {
    task: 'rewrite',
    mode: input.mode,
    tone: input.tone,
    scope: input.scope,
    keepCanon: input.keepCanon,
    autoContinue: input.autoContinue,
    thoughtLevel: input.thoughtLevel,
    prompt: input.prompt,
    sourceText: input.sourceText,
    outputSchema: {
      candidates: ['candidate 1 text', 'candidate 2 text', 'candidate 3 text'],
    },
  }

  try {
    const response = await requestOllamaChat({
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: Math.min(config.timeoutMs, 30000),
      temperature: input.tone === 'keep' ? 0.7 : 0.9,
      format: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: { type: 'string' },
            minItems: 3,
            maxItems: 3,
          },
        },
        required: ['candidates'],
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are a novel rewriting assistant.',
            'Return JSON only.',
            'Produce exactly 3 rewrite candidates in Chinese.',
            'Each candidate should be a coherent prose passage.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify(user) },
      ],
    })

    const raw = response.message?.content?.trim() ?? ''
    if (!raw) {
      return { enabled: true, error: 'No content returned from model' }
    }

    const parsed = parseStructuredContent(raw) as { candidates?: unknown[] }
    const candidates = Array.isArray(parsed.candidates)
      ? parsed.candidates.map((item) => String(item)).filter(Boolean).slice(0, 3)
      : []
    if (!candidates.length) {
      return { enabled: true, error: 'Model returned empty candidates' }
    }

    return { enabled: true, content: candidates }
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : 'Ollama rewrite failed',
    }
  }
}

export async function streamRewriteWithOllama(input: OllamaStreamRewriteRequest): Promise<OllamaStreamRewriteResult> {
  const config = await getOllamaRewriteConfig()
  if (!config.enabled || !config.model) {
    return { enabled: false, error: config.reason ?? 'Ollama rewrite config not set' }
  }

  try {
    const response = await requestOllamaChat({
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: Math.min(config.timeoutMs, 45000),
      temperature: input.temperature ?? 0.7,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    })

    const content = response.message?.content?.trim() ?? ''
    if (!content) {
      return { enabled: true, error: 'No content returned from model' }
    }

    return {
      enabled: true,
      stream: chunkTextStream(content),
    }
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : 'Ollama rewrite failed',
    }
  }
}
