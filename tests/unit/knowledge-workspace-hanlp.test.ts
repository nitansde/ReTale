import { describe, expect, it } from 'vitest'
import {
  getCharacterClassificationBadgeLabel,
  resolveHanlpCacheDeleteState,
  resolveKnowledgeRebuildFailureMessage,
} from '@/components/workspace/selection-novel-studio'

describe('knowledge workspace HanLP helpers', () => {
  it('maps projected character tiers to visible workspace labels', () => {
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'tier0', classificationLabel: 'Tier 0', importanceTier: 'protagonist' })).toBe('Tier 0 主角')
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'tier1', classificationLabel: 'Tier 1', importanceTier: 'important' })).toBe('Tier 1 重要配角')
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'tier2', classificationLabel: 'Tier 2', importanceTier: 'arc' })).toBe('Tier 2 篇章配角')
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'candidate', classificationLabel: null, importanceTier: 'candidate' })).toBe('Candidate')
  })

  it('blocks HanLP cache deletion while a rebuild is queued, running, or paused', () => {
    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'queued' },
      knowledgeActionLoading: null,
    })).toMatchObject({
      disabled: true,
      helperText: expect.stringContaining('需先终止或完成当前重建后才能删除缓存'),
    })

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'running' },
      knowledgeActionLoading: null,
    }).disabled).toBe(true)

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'paused' },
      knowledgeActionLoading: null,
    }).disabled).toBe(true)

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
    })).toMatchObject({
      disabled: false,
      helperText: expect.stringContaining('不会影响正文或原文 Embedding 缓存'),
    })

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'failed' },
      knowledgeActionLoading: null,
    }).disabled).toBe(false)
  })

  it('returns a clear fallback message for failed rebuild status', () => {
    expect(resolveKnowledgeRebuildFailureMessage({
      status: 'failed',
      errorMessage: 'HanLP bootstrap crashed on chapter 1',
    })).toBe('HanLP bootstrap crashed on chapter 1')

    expect(resolveKnowledgeRebuildFailureMessage({
      status: 'failed',
      errorMessage: '   ',
    })).toBe('知识视图重建失败，请重新发起重建。')

    expect(resolveKnowledgeRebuildFailureMessage({
      status: 'running',
      errorMessage: 'ignored',
    })).toBeNull()
  })
})
