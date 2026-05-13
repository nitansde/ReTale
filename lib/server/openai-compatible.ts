import { findAppSettings } from '@/lib/server/persistence'
import type { ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import {
  buildKnowledgeExtractionPrompt,
  hasUsableKnowledgeExtraction,
  normalizeKnowledgeExtraction,
  parseKnowledgeExtractionCandidates,
  type KnowledgeExtractionPromptMode,
} from '@/lib/server/ollama-local'

type RewriteRequest = {
  sourceText: string
  mode: string
  tone: string
  scope: string
  prompt: string
  keepCanon: boolean
  autoContinue: boolean
  thoughtLevel: string
}

export type RewriteResult = {
  enabled: boolean
  content?: string[]
  error?: string
}

export type StreamRewriteRequest = {
  systemPrompt: string
  userPrompt: string
  temperature?: number
}

export type StreamRewriteResult = {
  enabled: boolean
  stream?: ReadableStream<Uint8Array>
  error?: string
}

type OpenAICompatibleChatMessage = {
  role: 'system' | 'user'
  content: string
}

type OpenAICompatibleChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
}

export type OpenAICompatibleExtractionResult = {
  enabled: boolean
  extraction?: ChapterKnowledgeExtraction
  model?: string
  error?: string
}

export type OpenAICompatibleModelOption = {
  id: string
  label: string
  ownedBy?: string
}

type OpenAICompatibleModelsResponse = {
  data?: unknown
}

export function normalizeOpenAICompatibleBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/$/, '')
  if (!trimmed) {
    return ''
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Invalid OpenAI-compatible Base URL')
  }

  if (url.username || url.password) {
    throw new Error('Base URL must not include credentials')
  }

  if (url.search || url.hash) {
    throw new Error('Base URL must not include query or hash segments')
  }

  const protocol = url.protocol.toLowerCase()
  const hostname = url.hostname.toLowerCase()
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost')

  if (protocol === 'https:') {
    return trimmed
  }

  if (protocol === 'http:' && isLocalhost) {
    return trimmed
  }

  throw new Error('Remote OpenAI-compatible Base URL must use HTTPS')
}

async function getConfig() {
  const entries = findAppSettings(['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_MODEL'])

  const map = Object.fromEntries(entries.map((item) => [item.key, item.value]))

  const rawBaseUrl = (map.OPENAI_COMPATIBLE_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? '').trim()
  const apiKey = (map.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? '').trim()
  const model = (map.OPENAI_COMPATIBLE_MODEL ?? process.env.OPENAI_COMPATIBLE_MODEL ?? '').trim()
  let baseUrl = ''

  try {
    baseUrl = normalizeOpenAICompatibleBaseUrl(rawBaseUrl)
  } catch {
    baseUrl = ''
  }

  return {
    baseUrl,
    apiKey,
    model,
    enabled: Boolean(baseUrl && apiKey && model),
  }
}

function normalizeOpenAICompatibleModelItem(item: unknown): OpenAICompatibleModelOption | null {
  if (!item || typeof item !== 'object') return null

  const record = item as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null

  const ownedBy = typeof record.owned_by === 'string'
    ? record.owned_by.trim()
    : typeof record.ownedBy === 'string'
      ? record.ownedBy.trim()
      : ''

  return {
    id,
    label: ownedBy ? `${id} · ${ownedBy}` : id,
    ownedBy: ownedBy || undefined,
  }
}

export async function listAvailableOpenAICompatibleModels(
  baseUrlOverride?: string,
  apiKeyOverride?: string,
): Promise<{ baseUrl: string; models: OpenAICompatibleModelOption[] }> {
  const stored = await getConfig()
  const rawBaseUrl = baseUrlOverride?.trim() || stored.baseUrl
  if (!rawBaseUrl) {
    return { baseUrl: '', models: [] }
  }

  const baseUrl = normalizeOpenAICompatibleBaseUrl(rawBaseUrl)
  const apiKey = apiKeyOverride?.trim() || stored.apiKey

  const headers: HeadersInit = {}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(`${baseUrl}/models`, {
    cache: 'no-store',
    headers,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const data = await response.json() as OpenAICompatibleModelsResponse
  const rawItems = Array.isArray(data.data) ? data.data : []
  const models = rawItems
    .map(normalizeOpenAICompatibleModelItem)
    .filter((item): item is OpenAICompatibleModelOption => Boolean(item))
    .sort((left, right) => left.id.localeCompare(right.id))

  return { baseUrl, models }
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

function extractChatCompletionText(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        const record = item as Record<string, unknown>
        return typeof record.text === 'string' ? record.text : ''
      })
      .join('')
      .trim()
  }

  return ''
}

async function requestOpenAICompatibleChat(params: {
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenAICompatibleChatMessage[]
  timeoutMs: number
  temperature?: number
  responseFormat?: Record<string, unknown>
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        temperature: params.temperature ?? 0,
        response_format: params.responseFormat,
        messages: params.messages,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json() as OpenAICompatibleChatCompletionResponse
  } finally {
    clearTimeout(timeout)
  }
}

export async function extractChapterKnowledgeWithOpenAICompatible(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  mode?: KnowledgeExtractionPromptMode
}): Promise<OpenAICompatibleExtractionResult> {
  const config = await getConfig()
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const mode = params.mode ?? 'full'
  const prompt = buildKnowledgeExtractionPrompt(params.chapterTitle, params.chapterNo, params.rawText, mode)
  const timeoutMs = 120000
  let lastError = 'Failed to parse OpenAI-compatible JSON'
  let lastContent = ''

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await requestOpenAICompatibleChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs,
        responseFormat: { type: 'json_object' },
        messages: attempt === 0
          ? [
              {
                role: 'system',
                content: 'Return exactly one valid JSON object for chapter knowledge. Never return a top-level array. Never output markdown or commentary.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ]
          : [
              {
                role: 'system',
                content: 'Repair malformed JSON into exactly one valid JSON object for chapter knowledge. Never return a top-level array. Do not add commentary or markdown.',
              },
              {
                role: 'user',
                content: [
                  '下面是一段模型生成的无效 JSON，请只修复 JSON 结构与字段组织。',
                  '请只返回与当前请求格式完全匹配的 JSON 对象。',
                  '不要补充原文中不存在的事实，不要输出解释。',
                  `解析错误：${lastError}`,
                  '无效 JSON：',
                  lastContent,
                ].join('\n\n'),
              },
            ],
      })

      const content = extractChatCompletionText(response.choices?.[0]?.message?.content)
      lastContent = content
      if (!content) {
        lastError = 'OpenAI-compatible API returned empty content'
        continue
      }

      const parsedCandidates = parseKnowledgeExtractionCandidates(content)
      for (const parsed of parsedCandidates) {
        const extraction = normalizeKnowledgeExtraction(parsed, params.chapterNo)
        if (hasUsableKnowledgeExtraction(extraction, mode)) {
          return {
            enabled: true,
            model: config.model,
            extraction,
          }
        }
      }

      lastError = 'OpenAI-compatible API returned parseable JSON but no usable knowledge'
      if (attempt === 0) {
        continue
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'OpenAI-compatible extraction failed'
    }
  }

  return {
    enabled: true,
    model: config.model,
    error: lastError,
  }
}

export async function generateRewriteWithOpenAICompatible(input: RewriteRequest): Promise<RewriteResult> {
  const config = await getConfig()
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const system = [
    'You are a novel rewriting assistant.',
    'Return JSON only.',
    'Produce exactly 3 rewrite candidates in Chinese.',
    'Each candidate should be a coherent prose passage.',
  ].join(' ')

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

  const controller = new AbortController()
  const timeoutMs = 20000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: input.tone === 'keep' ? 0.7 : 0.9,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(user) },
        ],
      }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return { enabled: true, error: `Model request timed out after ${timeoutMs}ms` }
    }
    return { enabled: true, error: error instanceof Error ? error.message : 'Model request failed' }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    return { enabled: true, error: `HTTP ${response.status}` }
  }

  const data = await response.json()
  const raw = data?.choices?.[0]?.message?.content
  if (!raw) {
    return { enabled: true, error: 'No content returned from model' }
  }

  try {
    const parsed = JSON.parse(raw)
    const candidates = Array.isArray(parsed?.candidates)
      ? parsed.candidates.map((item: unknown) => String(item)).filter(Boolean).slice(0, 3)
      : []
    if (!candidates.length) {
      return { enabled: true, error: 'Model returned empty candidates' }
    }
    return { enabled: true, content: candidates }
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : 'Failed to parse model JSON',
    }
  }
}

export async function streamRewriteWithOpenAICompatible(input: StreamRewriteRequest): Promise<StreamRewriteResult> {
  const config = await getConfig()
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const controller = new AbortController()
  const timeoutMs = 30000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: input.temperature ?? 0.7,
        stream: true,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userPrompt },
        ],
      }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return { enabled: true, error: `Model request timed out after ${timeoutMs}ms` }
    }
    return { enabled: true, error: error instanceof Error ? error.message : 'Model request failed' }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    return { enabled: true, error: `HTTP ${response.status}` }
  }

  if (!response.body) {
    return { enabled: true, error: 'No response body returned from model' }
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const reader = response.body.getReader()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue

            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{
                  delta?: { content?: string }
                  message?: { content?: string }
                }>
              }
              const choice = parsed.choices?.[0]
              const content = choice?.delta?.content ?? choice?.message?.content ?? ''
              if (content) controller.enqueue(encoder.encode(content))
            } catch {
            }
          }
        }
      } catch (error) {
        controller.error(error)
        return
      }

      if (buffer.trim().startsWith('data:')) {
        const payload = buffer.trim().slice(5).trim()
        if (payload && payload !== '[DONE]') {
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{
                delta?: { content?: string }
                message?: { content?: string }
              }>
            }
            const choice = parsed.choices?.[0]
            const content = choice?.delta?.content ?? choice?.message?.content ?? ''
            if (content) controller.enqueue(encoder.encode(content))
          } catch {
          }
        }
      }

      controller.close()
    },
  })

  return { enabled: true, stream }
}

export function buildFallbackRewriteStream(text: string) {
  return chunkTextStream(text)
}
