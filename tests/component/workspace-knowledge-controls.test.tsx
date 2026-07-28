// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceKnowledgeControls } from '@/components/workspace/WorkspaceKnowledgeControls'
import { resolveRetrievalTaskControlsState } from '@/components/workspace/selection-novel-studio-helpers'

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'zh',
    t: (key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ''}`,
  }),
}))

type Props = ComponentProps<typeof WorkspaceKnowledgeControls>

const fullCoverage = {
  status: 'full' as const,
  coveredChapterCount: 64,
  totalChapterCount: 64,
  validThroughChapterNo: 64,
}

function buildProps(overrides: Partial<Props> = {}): Props {
  const knowledgeStatusOverview = {
    knowledgeGraph: fullCoverage,
    extractionCache: fullCoverage,
    embeddingCache: {
      ...fullCoverage,
      provider: 'ollama',
      model: 'qwen3-embedding:4b',
    },
    retrievalIndex: { status: 'full' as const, indexedScopeCount: 64, task: null },
  }
  const noop = () => undefined

  return {
    knowledgeRebuilding: false,
    knowledgeRebuildActive: false,
    knowledgeActionLoading: null,
    knowledgeRebuildPaused: false,
    knowledgeRebuildFailed: false,
    knowledgeRebuildRangeMode: 'all',
    knowledgeRebuildFirstChapterCount: '5',
    knowledgeRebuildStartChapter: '1',
    knowledgeRebuildEndChapter: '5',
    selectedKnowledgeRebuildChapterRangeLabel: '全部章节',
    knowledgeStatusOverview,
    currentKnowledgeJobBusy: false,
    knowledgeGraphOverview: knowledgeStatusOverview.knowledgeGraph,
    extractionCacheOverview: knowledgeStatusOverview.extractionCache,
    embeddingCacheOverview: knowledgeStatusOverview.embeddingCache,
    retrievalIndexOverview: knowledgeStatusOverview.retrievalIndex,
    retrievalIndexStatusLine: 'LanceDB 已覆盖全部章节。',
    retrievalTaskStatus: null,
    retrievalTaskStatusLabel: '已完成',
    retrievalTaskPercent: 100,
    retrievalTaskPhaseLabel: null,
    retrievalControlsState: resolveRetrievalTaskControlsState({
      retrievalTask: null,
      retrievalIndexOverview: knowledgeStatusOverview.retrievalIndex,
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    }),
    mainKnowledgeRebuildStatus: null,
    knowledgeRebuildOverallPercent: 0,
    knowledgeRebuildFailureMessage: null,
    knowledgeRebuildEtaMinutes: null,
    hanlpBootstrapStatusLine: 'HanLP 缓存就绪。',
    hanlpBootstrapCompletedChapterCount: null,
    hanlpBootstrapTotalChapterCount: null,
    hanlpCacheStatusLabel: '缓存就绪',
    hanlpBootstrapPercent: null,
    hanlpBootstrapCacheHitRatePercent: null,
    hanlpBootstrapPhaseLabel: '',
    hanlpBootstrapEtaLabel: '',
    hanlpBootstrapTimingLabel: null,
    hanlpSettingsLine: null,
    rawTextEmbeddingStatusLine: '原文 Embedding 缓存已覆盖全部 64 章。',
    rawTextEmbeddingActive: false,
    rawTextEmbeddingPhaseBadge: '已完成',
    rawTextEmbeddingPercent: 100,
    rawTextEmbeddingCacheHitRatePercent: null,
    rawTextEmbeddingTimingLabel: null,
    rawTextEmbeddingSettingsLine: 'Ollama · qwen3-embedding:4b',
    knowledgeRebuildSteps: [],
    currentKnowledgeRunningStepKey: null,
    confirmDeleteHanlpCache: false,
    confirmDeleteExtractionCache: false,
    confirmDeleteEmbeddingCache: false,
    confirmDeleteKnowledge: false,
    hanlpCacheDeleteState: { disabled: false, helperText: '可删除' },
    extractionCacheDeleteState: { disabled: false, helperText: '可删除' },
    embeddingCacheDeleteState: { disabled: false, helperText: '可删除' },
    onRebuildKnowledge: noop,
    onPauseKnowledge: noop,
    onAbortKnowledge: noop,
    onRebuildRetrievalIndex: noop,
    onSetKnowledgeRebuildRangeMode: noop,
    onSetKnowledgeRebuildFirstChapterCount: noop,
    onSetKnowledgeRebuildStartChapter: noop,
    onSetKnowledgeRebuildEndChapter: noop,
    onToggleConfirmDeleteHanlpCache: noop,
    onToggleConfirmDeleteExtractionCache: noop,
    onToggleConfirmDeleteEmbeddingCache: noop,
    onToggleConfirmDeleteKnowledge: noop,
    onCancelDeleteHanlpCache: noop,
    onCancelDeleteExtractionCache: noop,
    onCancelDeleteEmbeddingCache: noop,
    onCancelDeleteKnowledge: noop,
    onDeleteHanlpCache: noop,
    onDeleteExtractionCache: noop,
    onDeleteEmbeddingCache: noop,
    onDeleteKnowledgeGraph: noop,
    ...overrides,
  }
}

describe('WorkspaceKnowledgeControls durable cache cards', () => {
  beforeEach(() => {
    document.documentElement.dataset.locale = 'zh'
  })

  it('shows the compact user summary first and keeps diagnostics collapsed', () => {
    render(<WorkspaceKnowledgeControls {...buildProps()} />)

    const summary = screen.getByTestId('workspace-knowledge-status')
    expect(summary).toHaveTextContent('workspace.knowledge.status.storyAnalysis')
    expect(summary).toHaveTextContent('workspace.knowledge.status.contentSearch')
    expect(screen.queryByTestId('workspace-knowledge-advanced-details')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-extraction-cache-card')).not.toBeInTheDocument()
    expect(summary).not.toHaveTextContent(/HanLP|LLM|Embedding|LanceDB|%/i)
  })

  it('shows full idle extraction and embedding coverage without historical telemetry placeholders', () => {
    render(<WorkspaceKnowledgeControls {...buildProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))

    const extractionCard = screen.getByTestId('workspace-extraction-cache-card')
    const embeddingCard = screen.getByTestId('workspace-embedding-cache-card')

    expect(extractionCard).toHaveTextContent('64 章')
    expect(extractionCard).toHaveTextContent('已完成')
    expect(embeddingCard).toHaveTextContent('64 章')
    expect(embeddingCard).toHaveTextContent('100%')
    expect(embeddingCard).toHaveTextContent('Ollama · qwen3-embedding:4b')
    expect(embeddingCard).not.toHaveTextContent('batch')
    expect(embeddingCard).not.toHaveTextContent('缓存命中率')
    expect(embeddingCard).not.toHaveTextContent('阶段耗时')
    expect(embeddingCard).not.toHaveTextContent('等待进度')
    expect(embeddingCard).not.toHaveTextContent('暂未返回')
  })

  it('shows active telemetry in preference to durable embedding coverage', () => {
    render(<WorkspaceKnowledgeControls {...buildProps({
      rawTextEmbeddingActive: true,
      rawTextEmbeddingStatusLine: '与章节抽取并行进行，优先预热原文向量缓存。',
      rawTextEmbeddingPhaseBadge: '与抽取并行',
      rawTextEmbeddingPercent: 35,
      rawTextEmbeddingCacheHitRatePercent: 20,
      rawTextEmbeddingTimingLabel: '12 秒',
      rawTextEmbeddingSettingsLine: 'Ollama · qwen3-embedding:4b · batch 32',
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))

    const embeddingCard = screen.getByTestId('workspace-embedding-cache-card')
    expect(embeddingCard).toHaveTextContent('35%')
    expect(embeddingCard).toHaveTextContent('20%')
    expect(embeddingCard).toHaveTextContent('12 秒')
    expect(embeddingCard).toHaveTextContent('batch 32')
  })

  it('renders missing coverage immediately after a delete response replaces the overview', () => {
    const missingCoverage = {
      status: 'missing' as const,
      coveredChapterCount: 0,
      totalChapterCount: 64,
      validThroughChapterNo: null,
    }
    const { rerender } = render(<WorkspaceKnowledgeControls {...buildProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))

    rerender(<WorkspaceKnowledgeControls {...buildProps({
      extractionCacheOverview: missingCoverage,
      embeddingCacheOverview: { ...missingCoverage, provider: null, model: null },
      rawTextEmbeddingStatusLine: '原文 Embedding 缓存尚未建立（0 / 64 章）。',
      rawTextEmbeddingPhaseBadge: '缺失',
      rawTextEmbeddingPercent: 0,
      rawTextEmbeddingSettingsLine: null,
    })} />)

    expect(screen.getByTestId('workspace-extraction-cache-card')).toHaveTextContent('0 / 64 章')
    expect(screen.getByTestId('workspace-extraction-cache-card')).toHaveTextContent('缺失')
    expect(screen.getByTestId('workspace-embedding-cache-card')).toHaveTextContent('0 / 64 章')
    expect(screen.getByTestId('workspace-embedding-cache-card')).toHaveTextContent('缺失')
  })

  it('keeps raw failure diagnostics out of the primary summary', () => {
    const failedStatus = {
      jobId: 'job-1',
      novelId: 'novel-1',
      jobType: 'extract_chapter_knowledge' as const,
      status: 'failed',
      errorMessage: 'provider stack trace',
      progress: 0.4,
      currentStep: 'raw backend phase',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      etaMinutes: null,
      steps: [],
    }
    render(<WorkspaceKnowledgeControls {...buildProps({
      knowledgeRebuildFailed: true,
      mainKnowledgeRebuildStatus: failedStatus,
      knowledgeRebuildFailureMessage: 'provider stack trace',
    })} />)

    const summary = screen.getByTestId('workspace-knowledge-status')
    expect(summary).toHaveTextContent('workspace.knowledge.status.overall.failed')
    expect(summary).toHaveTextContent('workspace.knowledge.status.previousResultsAvailable')
    expect(summary).not.toHaveTextContent('provider stack trace')

    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))
    expect(screen.getByTestId('workspace-knowledge-advanced-details')).toHaveTextContent('provider stack trace')
  })
})
