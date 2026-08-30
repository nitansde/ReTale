import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/server/ai-settings', () => ({
  loadStoredAISettings: () => ({
    knowledgeExtraction: {
      provider: 'openai-compatible',
      openAICompatible: {
        configured: true,
        baseUrl: 'https://custom-model.example/v1',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      },
      ollama: {
        configured: false,
        baseUrl: '',
        model: '',
      },
    },
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: {
        configured: true,
        baseUrl: 'https://rewrite.example/v1',
        apiKey: 'test-key',
        model: 'deepseek-v4-flash',
      },
      ollama: {
        configured: false,
        baseUrl: '',
        model: '',
      },
    },
  }),
}))

import {
  ConfiguredWritingSkillModelGateway,
  getDefaultWritingSkillModelConfigId,
  getWritingSkillModelSummary,
  inferWritingSkillModelCapabilities,
  isWritingSkillContextLimitError,
} from '@/lib/server/writing-skill-model-gateway'
import { ProviderRequestError } from '@/lib/server/provider-request'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConfiguredWritingSkillModelGateway', () => {
  it('uses the rewrite model for new writing skill jobs and exposes its safe summary', () => {
    expect(getDefaultWritingSkillModelConfigId()).toBe('rewrite')
    expect(getWritingSkillModelSummary()).toEqual({
      modelConfigId: 'rewrite',
      provider: 'openai-compatible',
      model: 'deepseek-v4-flash',
    })
  })

  it('recognizes provider context-limit wording without treating unrelated token errors as context overflow', () => {
    expect(isWritingSkillContextLimitError(new ProviderRequestError(
      'http',
      'Writing skill structured generation failed with HTTP 400',
      400,
      JSON.stringify({ error: { message: 'Input too large for model context window' } }),
    ))).toBe(true)
    expect(isWritingSkillContextLimitError(new ProviderRequestError(
      'http',
      'Writing skill structured generation failed with HTTP 400',
      400,
      JSON.stringify({ error: { message: 'max_tokens must be an integer' } }),
    ))).toBe(false)
  })

  it('recognizes the large context window of GPT-OSS models', () => {
    expect(inferWritingSkillModelCapabilities({
      provider: 'openai-compatible',
      model: 'gpt-oss-120b',
    }).contextWindow).toBe(131_072)
  })

  it('recognizes the 1M context window of DeepSeek v4 flash', () => {
    const capabilities = inferWritingSkillModelCapabilities({
      provider: 'openai-compatible',
      model: 'deepseek-v4-flash',
    })
    expect(capabilities.contextWindow).toBe(1_000_000)
    expect(capabilities.supportsStructuredOutput).toBe(false)
  })

  it('keeps an operational fallback for unknown DeepSeek models and honors an explicit override', () => {
    const previous = process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW
    delete process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW
    expect(inferWritingSkillModelCapabilities({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
    }).contextWindow).toBe(96_000)
    process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW = '200000'
    try {
      expect(inferWritingSkillModelCapabilities({
        provider: 'openai-compatible',
        model: 'deepseek-chat',
      }).contextWindow).toBe(200_000)
      expect(inferWritingSkillModelCapabilities({
        provider: 'openai-compatible',
        model: 'private-custom-model',
      }).contextWindow).toBe(200_000)
    } finally {
      if (previous === undefined) delete process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW
      else process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW = previous
    }
  })

  it('normalizes parsed structured output before validation without an unnecessary repair call', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":1}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new ConfiguredWritingSkillModelGateway().generateStructured({
      modelConfigId: 'knowledgeExtraction',
      messages: [
        { role: 'system', content: 'Return the requested object.' },
        { role: 'user', content: 'Generate it.' },
      ],
      schemaName: 'normalized_plain_json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      runtimeSchema: z.object({ value: z.string() }).strict(),
      normalizeParsedOutput: (value) => ({
        value: String((value as { value?: unknown } | null)?.value ?? ''),
      }),
      maxOutputTokens: 512,
    })

    expect(result.data).toEqual({ value: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses plain JSON for DeepSeek and repairs format without response_format', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    let attempt = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      attempt += 1
      return new Response(JSON.stringify({
        choices: [{ message: { content: attempt === 1 ? '{"value":1}' : '{"value":"fixed"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const gateway = new ConfiguredWritingSkillModelGateway()
    const capabilities = await gateway.getCapabilities('rewrite')
    expect(capabilities.supportsStructuredOutput).toBe(false)
    expect(capabilities.supportsToolCalling).toBe(false)

    const result = await gateway.generateStructured({
      modelConfigId: 'rewrite',
      messages: [
        { role: 'system', content: 'Return the requested object.' },
        { role: 'user', content: 'Generate it.' },
      ],
      schemaName: 'custom_plain_json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      runtimeSchema: z.object({ value: z.string() }).strict(),
      maxOutputTokens: 512,
    })

    expect(result.data).toEqual({ value: 'fixed' })
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).not.toHaveProperty('response_format')
    expect(JSON.stringify(requestBodies[0])).toContain('当前模型不保证原生结构化输出')
    expect(JSON.stringify(requestBodies[1])).toContain('重新从本对话最初提供的原始任务与原始素材生成完整结果')
    expect(JSON.stringify(requestBodies[1])).toContain('Return the requested object.')
    expect(JSON.stringify(requestBodies[1])).not.toContain('待修复输出')
  })

  it('omits the provider output cap when maxOutputTokens is zero', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"value":"complete"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const result = await new ConfiguredWritingSkillModelGateway().generateStructured({
      modelConfigId: 'rewrite',
      messages: [
        { role: 'system', content: 'Return the requested object.' },
        { role: 'user', content: 'Generate it.' },
      ],
      schemaName: 'uncapped_plain_json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      runtimeSchema: z.object({ value: z.string() }).strict(),
      maxOutputTokens: 0,
    })

    expect(result.data).toEqual({ value: 'complete' })
    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).not.toHaveProperty('max_tokens')
  })

  it('keeps response_format disabled during repair after a provider rejects it', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    let attempt = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      attempt += 1
      if (attempt === 1) {
        return new Response(JSON.stringify({
          error: { message: 'This response_format type is unavailable now' },
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: attempt === 2 ? '{"value":1}' : '{"value":"fixed"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const result = await new ConfiguredWritingSkillModelGateway().generateStructured({
      modelConfigId: 'knowledgeExtraction',
      messages: [
        { role: 'system', content: 'Return the requested object.' },
        { role: 'user', content: 'Generate it.' },
      ],
      schemaName: 'fallback_plain_json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      runtimeSchema: z.object({ value: z.string() }).strict(),
      maxOutputTokens: 512,
    })

    expect(result.data).toEqual({ value: 'fixed' })
    expect(requestBodies).toHaveLength(3)
    expect(requestBodies[0]).toHaveProperty('response_format')
    expect(requestBodies[1]).not.toHaveProperty('response_format')
    expect(requestBodies[2]).not.toHaveProperty('response_format')
  })

  it('includes the actual model and provider detail when an HTTP request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Unsupported request parameter' },
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(new ConfiguredWritingSkillModelGateway().generateStructured({
      modelConfigId: 'rewrite',
      messages: [
        { role: 'system', content: 'Return the requested object.' },
        { role: 'user', content: 'Generate it.' },
      ],
      schemaName: 'failed_plain_json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      runtimeSchema: z.object({ value: z.string() }).strict(),
      maxOutputTokens: 512,
    })).rejects.toThrow('模型 deepseek-v4-flash 请求失败（HTTP 400）：Unsupported request parameter')
  })
})
