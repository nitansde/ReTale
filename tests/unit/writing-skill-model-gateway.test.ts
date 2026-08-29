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
        model: 'private-custom-model',
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
        model: 'rewrite-custom-model',
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
  inferWritingSkillModelCapabilities,
} from '@/lib/server/writing-skill-model-gateway'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConfiguredWritingSkillModelGateway', () => {
  it('recognizes the large context window of GPT-OSS models', () => {
    expect(inferWritingSkillModelCapabilities({
      provider: 'openai-compatible',
      model: 'gpt-oss-120b',
    }).contextWindow).toBe(131_072)
  })

  it('uses DeepSeek operational safe context instead of the previous 200K overestimate', () => {
    expect(inferWritingSkillModelCapabilities({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
    }).contextWindow).toBe(96_000)
  })

  it('does not let a global large-context override push DeepSeek beyond 96K', () => {
    const previous = process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW
    process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW = '200000'
    try {
      expect(inferWritingSkillModelCapabilities({
        provider: 'openai-compatible',
        model: 'deepseek-chat',
      }).contextWindow).toBe(96_000)
      expect(inferWritingSkillModelCapabilities({
        provider: 'openai-compatible',
        model: 'private-custom-model',
      }).contextWindow).toBe(200_000)
    } finally {
      if (previous === undefined) delete process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW
      else process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW = previous
    }
  })

  it('supports a custom model without tool calling, uses plain JSON, and repairs format once', async () => {
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
    const capabilities = await gateway.getCapabilities('knowledgeExtraction')
    expect(capabilities.supportsStructuredOutput).toBe(false)
    expect(capabilities.supportsToolCalling).toBe(false)

    const result = await gateway.generateStructured({
      modelConfigId: 'knowledgeExtraction',
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
    expect(JSON.stringify(requestBodies[1])).toContain('你是 JSON 格式修复器')
  })
})
