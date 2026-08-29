import type { z } from 'zod'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { safeParseJson } from '@/lib/server/json-parse'
import {
  NON_STREAM_PROVIDER_TIMEOUT_MS,
  ProviderRequestError,
  parseProviderJsonResponse,
  requestProviderEndpoint,
} from '@/lib/server/provider-request'
import { buildPlainJsonStructuredOutputInstruction } from '@/lib/server/writing-skill-prompts'
import type { AIScenarioKey } from '@/lib/types'
import type { ModelCapabilities } from '@/lib/writing-skill-defaults'

export type WritingSkillChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type StructuredGenerationResult<T> = {
  data: T
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export interface ModelGateway {
  getCapabilities(modelConfigId: string): Promise<ModelCapabilities>
  generateStructured<T>(options: {
    modelConfigId: string
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    runtimeSchema: z.ZodType<T>
    maxOutputTokens: number
    temperature?: number
    signal?: AbortSignal
  }): Promise<StructuredGenerationResult<T>>
}

type ResolvedModelConfig = {
  scenario: 'knowledgeExtraction' | 'rewrite'
  provider: 'openai-compatible' | 'ollama'
  model: string
  baseUrl: string
  apiKey: string
}

type RawModelResponse = {
  content: string
  inputTokens: number
  outputTokens: number
}

function normalizeToken(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function resolveScenario(modelConfigId: string): 'knowledgeExtraction' | 'rewrite' {
  const normalized = modelConfigId.trim() || 'knowledgeExtraction'
  if (normalized === 'knowledgeExtraction' || normalized.startsWith('knowledgeExtraction:')) {
    return 'knowledgeExtraction'
  }
  if (normalized === 'rewrite' || normalized.startsWith('rewrite:')) return 'rewrite'
  throw new Error('modelConfigId 必须引用 knowledgeExtraction 或 rewrite 模型配置')
}

export function resolveWritingSkillModelConfig(modelConfigId: string): ResolvedModelConfig {
  const scenario = resolveScenario(modelConfigId)
  const settings = loadStoredAISettings()[scenario]
  const provider = settings.provider
  const providerSettings = provider === 'openai-compatible'
    ? settings.openAICompatible
    : settings.ollama
  if (!providerSettings.configured || !providerSettings.baseUrl || !providerSettings.model) {
    throw new Error('当前写作技巧蒸馏模型尚未配置，请先在 AI 设置中配置对应模型')
  }
  return {
    scenario,
    provider,
    model: providerSettings.model,
    baseUrl: providerSettings.baseUrl,
    apiKey: provider === 'openai-compatible' ? settings.openAICompatible.apiKey : '',
  }
}

function inferContextWindow(model: string) {
  const configured = Number.parseInt(process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW ?? '', 10)
  const configuredWindow = Number.isFinite(configured) && configured >= 4096 ? configured : null
  const normalized = model.toLowerCase()
  if (/deepseek/.test(normalized)) return Math.min(configuredWindow ?? 96_000, 96_000)
  if (configuredWindow !== null) return configuredWindow
  if (/gpt-4\.1|gpt-5|gemini-2\.5|gemini-3/.test(normalized)) return 1_000_000
  if (/gpt-oss/.test(normalized)) return 131_072
  if (/o3|o4|claude-3|claude-4|qwen3|qwen2\.5/.test(normalized)) return 200_000
  if (/gpt-4o|gpt-4-turbo|llama-3\.1|llama3\.1|mistral-large/.test(normalized)) return 128_000
  if (/32k|32768/.test(normalized)) return 32_768
  return 32_000
}

export function isWritingSkillContextLimitError(error: unknown) {
  if (!(error instanceof Error)) return false
  const providerBody = error instanceof ProviderRequestError ? error.responseBody ?? '' : ''
  const message = `${error.message}\n${providerBody}`.toLowerCase()
  const explicitlyMentionsContext = /context|token|maximum|max(?:imum)? length|too long|超出|上下文|长度/.test(message)
  if (error instanceof ProviderRequestError) {
    return error.code === 'http'
      && [400, 413, 422].includes(error.status ?? 0)
      && explicitlyMentionsContext
  }
  return explicitlyMentionsContext && /exceed|limit|maximum|too long|超出|过长|上限/.test(message)
}

function inferMaxOutputTokens(model: string) {
  const configured = Number.parseInt(process.env.RETALE_WRITING_SKILL_MAX_OUTPUT_TOKENS ?? '', 10)
  if (Number.isFinite(configured) && configured >= 1024) return configured
  return /gpt-5|gpt-4\.1|o3|o4|claude-4|qwen3/i.test(model) ? 16_384 : 8_192
}

function inferStructuredOutput(provider: ResolvedModelConfig['provider'], model: string) {
  if (provider === 'ollama') return true
  return /^(gpt-|o\d|chatgpt-|claude-|gemini-|qwen|deepseek)/i.test(model.trim())
}

export function inferWritingSkillModelCapabilities(config: Pick<ResolvedModelConfig, 'provider' | 'model'>): ModelCapabilities {
  return {
    contextWindow: inferContextWindow(config.model),
    maxOutputTokens: inferMaxOutputTokens(config.model),
    supportsStructuredOutput: inferStructuredOutput(config.provider, config.model),
    supportsToolCalling: false,
  }
}

function extractOpenAIContent(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices.length) return ''
  const choice = choices[0]
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return ''
  const message = (choice as { message?: unknown }).message
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const text = (item as { text?: unknown }).text
        return typeof text === 'string' ? [text] : []
      }).join('')
    }
  }
  const text = (choice as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

function extractOpenAIUsage(data: unknown) {
  const usage = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { usage?: unknown }).usage
    : null
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return { inputTokens: 0, outputTokens: 0 }
  const record = usage as Record<string, unknown>
  return {
    inputTokens: normalizeToken(record.input_tokens ?? record.prompt_tokens),
    outputTokens: normalizeToken(record.output_tokens ?? record.completion_tokens),
  }
}

function extractOllamaContent(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const message = (data as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

function parseJsonContent(content: string) {
  const trimmed = content.trim()
  const direct = safeParseJson(trimmed)
  if (direct !== null) return direct
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) {
    const parsed = safeParseJson(fenced)
    if (parsed !== null) return parsed
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return safeParseJson(trimmed.slice(start, end + 1))
  return null
}

function formatSchemaIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')
}

export class ConfiguredWritingSkillModelGateway implements ModelGateway {
  async getCapabilities(modelConfigId: string) {
    return inferWritingSkillModelCapabilities(resolveWritingSkillModelConfig(modelConfigId))
  }

  private async requestOpenAICompatible(input: {
    config: ResolvedModelConfig
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    maxOutputTokens: number
    temperature: number
    structured: boolean
    signal?: AbortSignal
    attempt: number
  }): Promise<RawModelResponse> {
    const url = `${input.config.baseUrl.replace(/\/$/, '')}/chat/completions`
    const requestBody = {
      model: input.config.model,
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
      messages: input.messages,
      ...(input.structured ? {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      } : {}),
    }
    const { response, cleanup } = await requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Writing skill structured generation',
      url,
      model: input.config.model,
      requestBody,
      timeoutMs: NON_STREAM_PROVIDER_TIMEOUT_MS,
      streamed: false,
      debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
      inputSignal: input.signal,
      requestMessages: input.messages,
      requestInit: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(input.config.apiKey ? { Authorization: `Bearer ${input.config.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
      },
    })
    try {
      const { data } = await parseProviderJsonResponse<unknown>({
        provider: 'openai-compatible',
        model: input.config.model,
        response,
        streamed: false,
        request: { url, body: requestBody, messages: input.messages },
        debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
        invalidJsonMessage: '模型返回了无法解析的响应',
      })
      return { content: extractOpenAIContent(data), ...extractOpenAIUsage(data) }
    } finally {
      cleanup()
    }
  }

  private async requestOllama(input: {
    config: ResolvedModelConfig
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    maxOutputTokens: number
    temperature: number
    structured: boolean
    signal?: AbortSignal
    attempt: number
  }): Promise<RawModelResponse> {
    const url = `${input.config.baseUrl.replace(/\/$/, '')}/api/chat`
    const requestBody = {
      model: input.config.model,
      stream: false,
      think: false,
      messages: input.messages,
      ...(input.structured ? { format: input.schema } : { format: 'json' }),
      options: {
        temperature: input.temperature,
        num_predict: input.maxOutputTokens,
      },
    }
    const { response, cleanup } = await requestProviderEndpoint({
      provider: 'ollama',
      action: 'Writing skill structured generation',
      url,
      model: input.config.model,
      requestBody,
      timeoutMs: NON_STREAM_PROVIDER_TIMEOUT_MS,
      streamed: false,
      debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
      inputSignal: input.signal,
      requestMessages: input.messages,
      requestInit: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    })
    try {
      const { data } = await parseProviderJsonResponse<unknown>({
        provider: 'ollama',
        model: input.config.model,
        response,
        streamed: false,
        request: { url, body: requestBody, messages: input.messages },
        debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
        invalidJsonMessage: '本地模型返回了无法解析的响应',
      })
      const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
      return {
        content: extractOllamaContent(data),
        inputTokens: normalizeToken(record.prompt_eval_count),
        outputTokens: normalizeToken(record.eval_count),
      }
    } finally {
      cleanup()
    }
  }

  private async requestRaw(input: {
    config: ResolvedModelConfig
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    maxOutputTokens: number
    temperature: number
    structured: boolean
    signal?: AbortSignal
    attempt: number
  }) {
    return input.config.provider === 'openai-compatible'
      ? this.requestOpenAICompatible(input)
      : this.requestOllama(input)
  }

  async generateStructured<T>(options: {
    modelConfigId: string
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    runtimeSchema: z.ZodType<T>
    maxOutputTokens: number
    temperature?: number
    signal?: AbortSignal
  }): Promise<StructuredGenerationResult<T>> {
    const config = resolveWritingSkillModelConfig(options.modelConfigId)
    const capabilities = inferWritingSkillModelCapabilities(config)
    const temperature = options.temperature ?? 0
    const plainMessages = capabilities.supportsStructuredOutput
      ? options.messages
      : options.messages.map((message, index) => index === 0
        ? { ...message, content: `${message.content}\n\n${buildPlainJsonStructuredOutputInstruction(options.schema)}` }
        : message)

    let first: RawModelResponse
    try {
      first = await this.requestRaw({
        config,
        messages: plainMessages,
        schemaName: options.schemaName,
        schema: options.schema,
        maxOutputTokens: Math.min(options.maxOutputTokens, capabilities.maxOutputTokens),
        temperature,
        structured: capabilities.supportsStructuredOutput,
        signal: options.signal,
        attempt: 1,
      })
    } catch (error) {
      const structuredUnsupported = capabilities.supportsStructuredOutput
        && error instanceof ProviderRequestError
        && error.code === 'http'
        && (error.status === 400 || error.status === 404 || error.status === 422)
        && !isWritingSkillContextLimitError(error)
      if (!structuredUnsupported) throw error
      first = await this.requestRaw({
        config,
        messages: options.messages.map((message, index) => index === 0
          ? { ...message, content: `${message.content}\n\n${buildPlainJsonStructuredOutputInstruction(options.schema)}` }
          : message),
        schemaName: options.schemaName,
        schema: options.schema,
        maxOutputTokens: Math.min(options.maxOutputTokens, capabilities.maxOutputTokens),
        temperature,
        structured: false,
        signal: options.signal,
        attempt: 1,
      })
    }

    const parsed = parseJsonContent(first.content)
    const validated = options.runtimeSchema.safeParse(parsed)
    if (validated.success) {
      return {
        data: validated.data,
        usage: { inputTokens: first.inputTokens, outputTokens: first.outputTokens },
      }
    }

    const repairMessages: WritingSkillChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是 JSON 格式修复器。',
          '只修复结构、字段类型、缺失字段和长度约束。',
          '不得添加素材原文、解释或 Markdown。',
          buildPlainJsonStructuredOutputInstruction(options.schema),
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `验证错误：${formatSchemaIssues(validated.error)}`,
          '待修复输出：',
          first.content,
        ].join('\n\n'),
      },
    ]
    const repaired = await this.requestRaw({
      config,
      messages: repairMessages,
      schemaName: options.schemaName,
      schema: options.schema,
      maxOutputTokens: Math.min(options.maxOutputTokens, capabilities.maxOutputTokens),
      temperature: 0,
      structured: capabilities.supportsStructuredOutput,
      signal: options.signal,
      attempt: 2,
    })
    const repairedParsed = parseJsonContent(repaired.content)
    const repairedValidated = options.runtimeSchema.safeParse(repairedParsed)
    if (!repairedValidated.success) {
      throw new Error(`模型结构化输出修复失败：${formatSchemaIssues(repairedValidated.error)}`)
    }
    return {
      data: repairedValidated.data,
      usage: {
        inputTokens: first.inputTokens + repaired.inputTokens,
        outputTokens: first.outputTokens + repaired.outputTokens,
      },
    }
  }
}

export function getDefaultWritingSkillModelConfigId(scenario: AIScenarioKey = 'knowledgeExtraction') {
  return scenario === 'rewrite' ? 'rewrite' : 'knowledgeExtraction'
}
