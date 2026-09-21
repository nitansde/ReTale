import { describe, expect, it } from 'vitest'
import { resolveRewriteContextWindow } from '@/lib/preset-compat/runtime-integration'

describe('generated history context budgets', () => {
  it.each(['branch-lineage-full-text', 'roleplay-history'])('keeps %s above a preset budget so the user can explicitly compress it', (id) => {
    const history = '已生成历史'.repeat(70000)
    const result = resolveRewriteContextWindow({
      providerControlIntents: [{ field: 'openai_max_context', provider: 'openai-compatible', target: 'route', path: 'contextWindow.maxContextTokens', value: 1000 }],
      blocks: [{ id, content: history, priority: 'highest' }, { id: 'facts', content: '背景资料', priority: 'medium' }],
    })
    expect(result.blocks.find((block) => block.id === id)?.content).toBe(history)
    expect(result.metadata?.tokenEstimate).toBeGreaterThan(200000)
    expect(result.metadata?.trimmedBlockIds).toEqual(['facts'])
  })
})
