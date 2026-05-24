import type { AIScenarioKey, OpenAICompatibleProviderSettings } from '@/lib/types'
import type { ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { writeLlmDebugLog, type LlmDebugLogParams } from '@/lib/server/llm-debug-log'
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
  systemPrompt?: string
  userPrompt?: string
  requestOptions?: Partial<{
    temperature: number
    top_p: number
    frequency_penalty: number
    presence_penalty: number
    max_tokens: number
  }>
  presetCompat?: unknown
  signal?: AbortSignal
}

export type RewriteResult = {
  enabled: boolean
  content?: string[]
  usage?: {
    inputTokens: number | null
    outputTokens: number | null
  }
  error?: string
}

export type StreamRewriteRequest = {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  requestOptions?: Partial<{
    temperature: number
    top_p: number
    frequency_penalty: number
    presence_penalty: number
    max_tokens: number
  }>
  presetCompat?: unknown
  signal?: AbortSignal
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
    text?: unknown
    message?: {
      content?: unknown
    }
    delta?: {
      content?: unknown
    }
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    input_tokens?: unknown
    output_tokens?: unknown
  }
}

function normalizeTokenCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
}

function extractUsage(usage: OpenAICompatibleChatCompletionResponse['usage']) {
  if (!usage) return { inputTokens: null, outputTokens: null }
  return {
    inputTokens: normalizeTokenCount(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: normalizeTokenCount(usage.output_tokens ?? usage.completion_tokens),
  }
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

type OpenAICompatibleEmbeddingsResponse = {
  data?: Array<{
    embedding?: unknown
  }>
  model?: string
}

export type OpenAICompatibleEmbeddingResult = {
  enabled: boolean
  embeddings?: number[][]
  model?: string
  error?: string
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

function getConfig(
  scenario: AIScenarioKey,
  override?: Partial<OpenAICompatibleProviderSettings>
) {
  const stored = loadStoredAISettings()[scenario].openAICompatible
  const rawBaseUrl = (override?.baseUrl?.trim() || stored.baseUrl || '').trim()
  const apiKey = (override?.apiKey?.trim() || stored.apiKey || '').trim()
  const model = (override?.model?.trim() || stored.model || '').trim()
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
  scenario: AIScenarioKey = 'rewrite',
): Promise<{ baseUrl: string; models: OpenAICompatibleModelOption[] }> {
  const stored = getConfig(scenario)
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

function collectChatCompletionText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        return collectChatCompletionText(item)
      })
      .join('')
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>
    const text = collectChatCompletionText(record.text)
    if (text) return text

    const outputText = collectChatCompletionText(record.output_text)
    if (outputText) return outputText

    return collectChatCompletionText(record.content)
  }

  return ''
}

function extractChatCompletionText(content: unknown) {
  return collectChatCompletionText(content).trim()
}

function extractChatCompletionChoiceText(choice: unknown) {
  if (!choice || typeof choice !== 'object') return ''

  const record = choice as Record<string, unknown>
  const delta = record.delta && typeof record.delta === 'object' ? record.delta as Record<string, unknown> : null
  const message = record.message && typeof record.message === 'object' ? record.message as Record<string, unknown> : null

  return [
    collectChatCompletionText(delta?.content),
    collectChatCompletionText(message?.content),
    collectChatCompletionText(record.text),
    collectChatCompletionText(record.output_text),
    collectChatCompletionText(record.content),
  ].find(Boolean) ?? ''
}

function extractChatCompletionResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''

  const record = payload as Record<string, unknown>
  if (Array.isArray(record.choices)) {
    const text = record.choices.map(extractChatCompletionChoiceText).join('')
    if (text) return text
  }

  const delta = record.delta && typeof record.delta === 'object' ? record.delta as Record<string, unknown> : null
  const message = record.message && typeof record.message === 'object' ? record.message as Record<string, unknown> : null

  return [
    collectChatCompletionText(record.delta),
    collectChatCompletionText(delta?.content),
    collectChatCompletionText(message?.content),
    collectChatCompletionText(record.text),
    collectChatCompletionText(record.output_text),
    collectChatCompletionText(record.content),
  ].find(Boolean) ?? ''
}

function extractStreamPayloadText(payload: string) {
  const trimmed = payload.trim()
  if (!trimmed || trimmed === '[DONE]') return ''

  try {
    return extractChatCompletionResponseText(JSON.parse(trimmed))
  } catch {
    return trimmed.startsWith('{')
      || trimmed.startsWith('[')
      || trimmed.startsWith('}')
      || trimmed.startsWith(']')
      || trimmed.startsWith('"')
      || trimmed.startsWith(',')
      ? ''
      : trimmed
  }
}

async function requestOpenAICompatibleChat(params: {
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenAICompatibleChatMessage[]
  timeoutMs: number
  temperature?: number
  responseFormat?: Record<string, unknown>
  debug?: Pick<LlmDebugLogParams, 'folder' | 'stage' | 'attempt'>
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  const requestBody = {
    model: params.model,
    temperature: params.temperature ?? 0,
    response_format: params.responseFormat,
    messages: params.messages,
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    if (!response.ok) {
      await writeLlmDebugLog({
        folder: params.debug?.folder ?? 'openai-compatible',
        provider: 'openai-compatible',
        model: params.model,
        streamed: false,
        stage: params.debug?.stage,
        attempt: params.debug?.attempt,
        request: { url, body: requestBody, messages: params.messages },
        response: { status: response.status, error: `HTTP ${response.status}` },
      })
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json() as OpenAICompatibleChatCompletionResponse
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? 'openai-compatible',
      provider: 'openai-compatible',
      model: params.model,
      streamed: false,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      request: { url, body: requestBody, messages: params.messages },
      response: {
        status: response.status,
        rawText: extractChatCompletionResponseText(data),
        parsed: data,
      },
    })
    return data
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('HTTP ')) {
      throw error
    }
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? 'openai-compatible',
      provider: 'openai-compatible',
      model: params.model,
      streamed: false,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      request: { url, body: requestBody, messages: params.messages },
      response: { error: error instanceof Error ? error.message : 'OpenAI-compatible request failed' },
    })
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function extractChapterKnowledgeWithOpenAICompatible(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  storyStateText?: string
  mode?: KnowledgeExtractionPromptMode
}, configOverride?: Partial<OpenAICompatibleProviderSettings>): Promise<OpenAICompatibleExtractionResult> {
  const config = getConfig('knowledgeExtraction', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const mode = params.mode ?? 'full'
  const prompt = buildKnowledgeExtractionPrompt(
    params.chapterTitle,
    params.chapterNo,
    params.rawText,
    mode,
    params.storyStateText,
  )
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
        debug: {
          folder: 'knowledge-extraction',
          stage: attempt === 0 ? 'extract' : 'repair',
          attempt,
        },
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

      const content = extractChatCompletionResponseText(response)
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

export async function generateRewriteWithOpenAICompatible(
  input: RewriteRequest,
  configOverride?: Partial<OpenAICompatibleProviderSettings>
): Promise<RewriteResult> {
  const config = getConfig('rewrite', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
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
      result: 'rewritten text',
    },
  }

  const controller = new AbortController()
  const timeoutMs = 20000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromInputSignal = () => controller.abort()
  const cleanupInputSignal = () => input.signal?.removeEventListener('abort', abortFromInputSignal)
  if (input.signal?.aborted) {
    controller.abort()
  } else {
    input.signal?.addEventListener('abort', abortFromInputSignal, { once: true })
  }
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const messages: OpenAICompatibleChatMessage[] = [
    {
      role: 'system',
      content: input.systemPrompt?.trim() || [
        'You are a novel rewriting assistant.',
        'Return JSON only.',
        'Produce one rewrite result in Chinese.',
        'The result should be a coherent prose passage.',
      ].join(' '),
    },
    { role: 'user', content: input.userPrompt?.trim() || JSON.stringify(user) },
  ]
  const requestBody = {
    model: config.model,
    temperature: input.requestOptions?.temperature ?? (input.tone === 'keep' ? 0.7 : 0.9),
    ...(typeof input.requestOptions?.top_p === 'number' ? { top_p: input.requestOptions.top_p } : {}),
    ...(typeof input.requestOptions?.frequency_penalty === 'number' ? { frequency_penalty: input.requestOptions.frequency_penalty } : {}),
    ...(typeof input.requestOptions?.presence_penalty === 'number' ? { presence_penalty: input.requestOptions.presence_penalty } : {}),
    ...(typeof input.requestOptions?.max_tokens === 'number' ? { max_tokens: input.requestOptions.max_tokens } : {}),
    response_format: { type: 'json_object' },
    messages,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch (error) {
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: false,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: { error: error instanceof Error ? error.message : 'Model request failed' },
    })
    if (error instanceof Error && error.name === 'AbortError') {
      cleanupInputSignal()
      return { enabled: true, error: input.signal?.aborted ? 'Model request aborted' : `Model request timed out after ${timeoutMs}ms` }
    }
    cleanupInputSignal()
    return { enabled: true, error: error instanceof Error ? error.message : 'Model request failed' }
  } finally {
    clearTimeout(timeout)
    cleanupInputSignal()
  }

  if (!response.ok) {
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: false,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: { status: response.status, error: `HTTP ${response.status}` },
    })
    return { enabled: true, error: `HTTP ${response.status}` }
  }

  const data = await response.json()
  const raw = extractChatCompletionResponseText(data)
  const usage = extractUsage((data as OpenAICompatibleChatCompletionResponse).usage)
  if (!raw) {
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: false,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: { status: response.status, parsed: data, error: 'No content returned from model' },
    })
    return { enabled: true, error: 'No content returned from model' }
  }

  try {
    const parsed = JSON.parse(raw)
    const candidates = typeof parsed?.result === 'string'
      ? [parsed.result].filter(Boolean)
      : Array.isArray(parsed?.candidates)
        ? parsed.candidates.map((item: unknown) => String(item)).filter(Boolean).slice(0, 1)
        : []
    if (!candidates.length) {
      await writeLlmDebugLog({
        folder: 'rewrite',
        provider: 'openai-compatible',
        model: config.model,
        streamed: false,
        stage: 'rewrite',
        presetCompat: input.presetCompat,
        request: { url, body: requestBody, messages },
        response: { status: response.status, rawText: extractChatCompletionText(raw), parsed, error: 'Model returned empty candidates' },
      })
      return { enabled: true, error: 'Model returned empty candidates' }
    }
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: false,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: { status: response.status, rawText: extractChatCompletionText(raw), parsed },
    })
    return { enabled: true, content: candidates, usage }
  } catch (error) {
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: false,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: {
        status: response.status,
        rawText: extractChatCompletionText(raw),
        parsed: data,
        error: error instanceof Error ? error.message : 'Failed to parse model JSON',
      },
    })
    return {
      enabled: true,
      error: error instanceof Error ? error.message : 'Failed to parse model JSON',
    }
  }
}

export async function streamRewriteWithOpenAICompatible(
  input: StreamRewriteRequest,
  configOverride?: Partial<OpenAICompatibleProviderSettings>
): Promise<StreamRewriteResult> {
  const config = getConfig('rewrite', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const controller = new AbortController()
  const timeoutMs = 30000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromInputSignal = () => controller.abort()
  const cleanupInputSignal = () => input.signal?.removeEventListener('abort', abortFromInputSignal)
  if (input.signal?.aborted) {
    controller.abort()
  } else {
    input.signal?.addEventListener('abort', abortFromInputSignal, { once: true })
  }
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const messages: OpenAICompatibleChatMessage[] = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ]
  const requestBody = {
    model: config.model,
    temperature: input.requestOptions?.temperature ?? input.temperature ?? 0.7,
    ...(typeof input.requestOptions?.top_p === 'number' ? { top_p: input.requestOptions.top_p } : {}),
    ...(typeof input.requestOptions?.frequency_penalty === 'number' ? { frequency_penalty: input.requestOptions.frequency_penalty } : {}),
    ...(typeof input.requestOptions?.presence_penalty === 'number' ? { presence_penalty: input.requestOptions.presence_penalty } : {}),
    ...(typeof input.requestOptions?.max_tokens === 'number' ? { max_tokens: input.requestOptions.max_tokens } : {}),
    stream: true,
    messages,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch (error) {
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: true,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: { error: error instanceof Error ? error.message : 'Model request failed' },
    })
    if (error instanceof Error && error.name === 'AbortError') {
      cleanupInputSignal()
      return { enabled: true, error: input.signal?.aborted ? 'Model request aborted' : `Model request timed out after ${timeoutMs}ms` }
    }
    cleanupInputSignal()
    return { enabled: true, error: error instanceof Error ? error.message : 'Model request failed' }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: true,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: { status: response.status, error: `HTTP ${response.status}` },
    })
    cleanupInputSignal()
    return { enabled: true, error: `HTTP ${response.status}` }
  }

  if (!response.body) {
    await writeLlmDebugLog({
      folder: 'rewrite',
      provider: 'openai-compatible',
      model: config.model,
      streamed: true,
      stage: 'rewrite',
      presetCompat: input.presetCompat,
      request: { url, body: requestBody, messages },
      response: { status: response.status, error: 'No response body returned from model' },
    })
    cleanupInputSignal()
    return { enabled: true, error: 'No response body returned from model' }
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const reader = response.body.getReader()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = ''
      let rawText = ''
      let upstreamText = ''

      const enqueueText = (text: string) => {
        if (!text) return
        rawText += text
        controller.enqueue(encoder.encode(text))
      }

      const consumePayload = (payload: string) => {
        enqueueText(extractStreamPayloadText(payload))
      }

      const consumeLine = (rawLine: string) => {
        const line = rawLine.trim()
        if (!line) return

        if (line.startsWith('data:')) {
          consumePayload(line.slice(5).trim())
          return
        }

        consumePayload(line)
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          upstreamText += chunk
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const rawLine of lines) {
            consumeLine(rawLine)
          }
        }
      } catch (error) {
        await writeLlmDebugLog({
          folder: 'rewrite',
          provider: 'openai-compatible',
          model: config.model,
          streamed: true,
          stage: 'rewrite',
          presetCompat: input.presetCompat,
          request: { url, body: requestBody, messages },
          response: {
            status: response.status,
            rawText,
            parsed: { upstreamText },
            error: error instanceof Error ? error.message : 'OpenAI-compatible stream failed',
            partial: true,
          },
        })
        controller.error(error)
        return
      } finally {
        cleanupInputSignal()
      }

      const finalDecoderChunk = decoder.decode()
      if (finalDecoderChunk) {
        upstreamText += finalDecoderChunk
        buffer += finalDecoderChunk
      }

      if (buffer.trim()) {
        consumeLine(buffer)
      }

      if (!rawText) {
        consumePayload(upstreamText)
      }

      await writeLlmDebugLog({
        folder: 'rewrite',
        provider: 'openai-compatible',
        model: config.model,
        streamed: true,
        stage: 'rewrite',
        presetCompat: input.presetCompat,
        request: { url, body: requestBody, messages },
        response: { status: response.status, rawText, parsed: rawText ? undefined : { upstreamText } },
      })
      controller.close()
    },
  })

  return { enabled: true, stream }
}

export function buildFallbackRewriteStream(text: string) {
  return chunkTextStream(text)
}

export async function embedTextsWithOpenAICompatible(
  input: string | string[],
  configOverride?: Partial<OpenAICompatibleProviderSettings>
): Promise<OpenAICompatibleEmbeddingResult> {
  const config = getConfig('embeddings', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const normalizedInput = (Array.isArray(input) ? input : [input])
    .map((item) => item.trim())
    .filter(Boolean)

  if (!normalizedInput.length) {
    return {
      enabled: true,
      embeddings: [],
      model: config.model,
    }
  }

  const controller = new AbortController()
  const timeoutMs = 30000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: Array.isArray(input) ? normalizedInput : normalizedInput[0],
        encoding_format: 'float',
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return { enabled: true, model: config.model, error: `HTTP ${response.status}` }
    }

    const data = await response.json() as OpenAICompatibleEmbeddingsResponse
    const embeddings = Array.isArray(data.data)
      ? data.data
          .map((item) => (Array.isArray(item?.embedding) ? item.embedding : null))
          .filter((vector): vector is number[] => Array.isArray(vector) && vector.length > 0 && vector.every((value) => Number.isFinite(value)))
      : []

    if (!embeddings.length) {
      return {
        enabled: true,
        model: config.model,
        error: 'OpenAI-compatible embedding response did not contain usable vectors',
      }
    }

    return {
      enabled: true,
      embeddings,
      model: data.model ?? config.model,
    }
  } catch (error) {
    return {
      enabled: true,
      model: config.model,
      error: error instanceof Error ? error.message : 'Failed to generate embeddings with OpenAI-compatible API',
    }
  } finally {
    clearTimeout(timeout)
  }
}
