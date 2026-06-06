import { writeLlmDebugLog, type LlmDebugLogParams } from '@/lib/server/llm-debug-log'

type ProviderName = 'openai-compatible' | 'ollama'

type ProviderRequestDebug = Pick<LlmDebugLogParams, 'folder' | 'stage' | 'attempt' | 'presetCompat'>

type ProviderRequestContext = {
  response: Response
  cleanup: () => void
}

type ProviderRequestMessage = {
  role: string
  content: string
}

export class ProviderRequestError extends Error {
  code: 'timeout' | 'aborted' | 'network' | 'http' | 'empty' | 'invalid_json'
  status?: number

  constructor(
    code: ProviderRequestError['code'],
    message: string,
    status?: number,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
    this.code = code
    this.status = status
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function toDebugMessages(value: unknown): Array<{ role: string; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined

  const messages = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const role = 'role' in item && typeof item.role === 'string' ? item.role : null
    const content = 'content' in item && typeof item.content === 'string' ? item.content : null
    return role && content ? [{ role, content }] : []
  })

  return messages.length ? messages : undefined
}

function buildRequestError(params: {
  provider: ProviderName
  action: string
  timeoutMs: number
  error: unknown
  inputSignal?: AbortSignal
}) {
  if (isAbortError(params.error)) {
    return params.inputSignal?.aborted
      ? new ProviderRequestError('aborted', `${params.action} aborted`)
      : new ProviderRequestError('timeout', `${params.action} timed out after ${params.timeoutMs}ms`)
  }

  return new ProviderRequestError('network', `${params.action} failed`)
}

export async function requestProviderEndpoint(params: {
  provider: ProviderName
  action: string
  url: string
  model: string
  requestBody: unknown
  requestInit: RequestInit
  timeoutMs: number
  streamed: boolean
  debug?: ProviderRequestDebug
  inputSignal?: AbortSignal
  requestMessages?: ProviderRequestMessage[]
  noBodyMessage?: string
}): Promise<ProviderRequestContext> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)
  const abortFromInputSignal = () => controller.abort()

  if (params.inputSignal?.aborted) {
    controller.abort()
  } else {
    params.inputSignal?.addEventListener('abort', abortFromInputSignal, { once: true })
  }

  const cleanup = () => {
    clearTimeout(timeout)
    params.inputSignal?.removeEventListener('abort', abortFromInputSignal)
  }

  try {
    const response = await fetch(params.url, {
      ...params.requestInit,
      signal: controller.signal,
    })

    if (!response.ok) {
      const rawText = await response.text().catch(() => '')
      const error = new ProviderRequestError('http', `${params.action} failed with HTTP ${response.status}`, response.status)
      await writeLlmDebugLog({
        folder: params.debug?.folder ?? params.provider,
        provider: params.provider,
        model: params.model,
        streamed: params.streamed,
        stage: params.debug?.stage,
        attempt: params.debug?.attempt,
        presetCompat: params.debug?.presetCompat,
        request: { url: params.url, body: params.requestBody, messages: toDebugMessages(params.requestMessages) },
        response: { status: response.status, rawText, error: error.message },
      })
      throw error
    }

    if (params.noBodyMessage && !response.body) {
      const error = new ProviderRequestError('empty', params.noBodyMessage)
      await writeLlmDebugLog({
        folder: params.debug?.folder ?? params.provider,
        provider: params.provider,
        model: params.model,
        streamed: params.streamed,
        stage: params.debug?.stage,
        attempt: params.debug?.attempt,
        presetCompat: params.debug?.presetCompat,
        request: { url: params.url, body: params.requestBody, messages: toDebugMessages(params.requestMessages) },
        response: { status: response.status, error: error.message },
      })
      throw error
    }

    return { response, cleanup }
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      cleanup()
      throw error
    }

    const normalizedError = buildRequestError({
      provider: params.provider,
      action: params.action,
      timeoutMs: params.timeoutMs,
      error,
      inputSignal: params.inputSignal,
    })
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? params.provider,
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      presetCompat: params.debug?.presetCompat,
      request: { url: params.url, body: params.requestBody, messages: toDebugMessages(params.requestMessages) },
      response: { error: normalizedError.message },
    })
    cleanup()
    throw normalizedError
  }
}

export async function parseProviderJsonResponse<T>(params: {
  provider: ProviderName
  model: string
  response: Response
  streamed: boolean
  request: {
    url: string
    body: unknown
    messages?: ProviderRequestMessage[]
  }
  debug?: ProviderRequestDebug
  invalidJsonMessage: string
  emptyBodyMessage?: string
}) {
  const rawText = await params.response.text().catch(() => '')
  if (!rawText.trim()) {
    const error = new ProviderRequestError('empty', params.emptyBodyMessage ?? 'Provider returned an empty response body')
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? params.provider,
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      presetCompat: params.debug?.presetCompat,
      request: params.request,
      response: { status: params.response.status, rawText, error: error.message },
    })
    throw error
  }

  try {
    return {
      data: JSON.parse(rawText) as T,
      rawText,
    }
  } catch {
    const error = new ProviderRequestError('invalid_json', params.invalidJsonMessage)
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? params.provider,
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      presetCompat: params.debug?.presetCompat,
      request: params.request,
      response: { status: params.response.status, rawText, error: error.message },
    })
    throw error
  }
}
