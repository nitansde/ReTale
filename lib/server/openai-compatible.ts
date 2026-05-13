import { findAppSettings } from '@/lib/server/persistence'

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

async function getConfig() {
  const entries = findAppSettings(['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_MODEL'])

  const map = Object.fromEntries(entries.map((item) => [item.key, item.value]))

  const baseUrl = (map.OPENAI_COMPATIBLE_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? '').trim()
  const apiKey = (map.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? '').trim()
  const model = (map.OPENAI_COMPATIBLE_MODEL ?? process.env.OPENAI_COMPATIBLE_MODEL ?? '').trim()

  return {
    baseUrl,
    apiKey,
    model,
    enabled: Boolean(baseUrl && apiKey && model),
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
    const text = await response.text()
    return { enabled: true, error: `HTTP ${response.status}: ${text.slice(0, 500)}` }
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
    const text = await response.text()
    return { enabled: true, error: `HTTP ${response.status}: ${text.slice(0, 500)}` }
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
