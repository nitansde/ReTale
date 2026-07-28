// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceKnowledgeStatus } from '@/components/workspace/WorkspaceKnowledgeStatus'
import type { WorkspaceKnowledgeStatus as Status } from '@/components/workspace/workspace-knowledge-status'
import { getMessage, type Locale } from '@/lib/i18n/messages'

const i18nState = vi.hoisted(() => ({ locale: 'zh' as Locale }))

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: i18nState.locale,
    t: (key: Parameters<typeof getMessage>[1], values?: Parameters<typeof getMessage>[2]) => getMessage(i18nState.locale, key, values),
  }),
}))

const readyStatus: Status = {
  overall: 'ready',
  analysis: 'ready',
  search: 'ready',
  analysisCoverage: { kind: 'all', count: 12 },
  searchCoverage: { kind: 'all', count: 12 },
  operation: null,
  analysisResultsUsable: true,
  searchResultsUsable: true,
  searchMayBeStale: false,
}

function renderStatus(status: Status, overrides: Partial<Parameters<typeof WorkspaceKnowledgeStatus>[0]> = {}) {
  const props = {
    status,
    advancedDetailsOpen: false,
    onAdvancedDetailsChange: vi.fn(),
    onPrepareAnalysis: vi.fn(),
    onPrepareSearch: vi.fn(),
    ...overrides,
  }
  render(<WorkspaceKnowledgeStatus {...props} />)
  return props
}

describe('WorkspaceKnowledgeStatus', () => {
  beforeEach(() => { i18nState.locale = 'zh' })

  it('keeps the durable headline and canonical result coverage primary', () => {
    renderStatus(readyStatus)

    const summary = screen.getByTestId('workspace-knowledge-status')
    expect(summary).toHaveTextContent('故事知识已准备好')
    expect(summary).toHaveTextContent('故事分析')
    expect(summary).toHaveTextContent('内容检索准备')
    expect(summary).toHaveTextContent('全部 12 章')
    expect(summary).not.toHaveTextContent(/HanLP|LLM|Embedding|LanceDB|provider|model|errorMessage|currentStep/i)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('renders exactly one accessible phase-local progressbar for running work', () => {
    renderStatus({
      ...readyStatus,
      operation: { jobId: 'job-1', stage: 'analysis', status: 'running', phaseLabel: 'raw backend phase', progressPercent: 36, progressSource: 'phase' },
    })

    const progress = screen.getByRole('progressbar', { name: '故事分析当前阶段进度' })
    expect(progress).toHaveAttribute('aria-valuemin', '0')
    expect(progress).toHaveAttribute('aria-valuemax', '100')
    expect(progress).toHaveAttribute('aria-valuenow', '36')
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(screen.getByTestId('workspace-knowledge-status')).toHaveTextContent('36%')
    expect(screen.getByTestId('workspace-knowledge-status')).not.toHaveTextContent('95%')
    expect(screen.getByTestId('workspace-knowledge-status')).not.toHaveTextContent('raw backend phase')
  })

  it('shows queued state without inventing zero percent progress', () => {
    renderStatus({
      ...readyStatus,
      operation: { jobId: 'job-1', stage: 'analysis', status: 'queued', phaseLabel: 'queued', progressPercent: null, progressSource: null },
    })

    expect(screen.getByTestId('workspace-knowledge-status')).toHaveTextContent('已排队')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-knowledge-status')).not.toHaveTextContent('0%')
  })

  it('labels job-level fallback progress generically and keeps one progressbar', () => {
    renderStatus({
      ...readyStatus,
      operation: { jobId: 'job-1', stage: 'analysis', status: 'running', phaseLabel: null, progressPercent: 63, progressSource: 'job' },
    })

    expect(screen.getByRole('progressbar', { name: '后台任务整体进度' })).toHaveAttribute('aria-valuenow', '63')
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(screen.getByTestId('workspace-knowledge-status')).toHaveTextContent('63%')
  })

  it.each(['paused', 'failed'] as const)('overlays %s state without replacing durable readiness or rendering progress', (operationStatus) => {
    renderStatus({
      ...readyStatus,
      operation: { jobId: 'job-1', stage: 'analysis', status: operationStatus, phaseLabel: 'provider stack trace', progressPercent: null, progressSource: null },
    })

    expect(screen.getByText('故事知识已准备好')).toBeInTheDocument()
    expect(screen.getByText('之前已完成的结果仍可继续使用。')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-knowledge-status')).not.toHaveTextContent('provider stack trace')
  })

  it('offers the existing search preparation action when durable search is stale', () => {
    const onPrepareSearch = vi.fn()
    renderStatus({
      ...readyStatus,
      overall: 'analysis_ready_search_not_ready',
      search: 'not_ready',
      searchCoverage: null,
      searchResultsUsable: false,
      searchMayBeStale: true,
    }, { onPrepareSearch })

    fireEvent.click(screen.getByRole('button', { name: '准备内容检索' }))
    expect(onPrepareSearch).toHaveBeenCalledTimes(1)
  })

  it('preserves the retry callback for a failed durable refresh', () => {
    const onPrepareAnalysis = vi.fn()
    renderStatus({
      ...readyStatus,
      operation: { jobId: 'job-1', stage: 'analysis', status: 'failed', phaseLabel: null, progressPercent: null, progressSource: null },
    }, { onPrepareAnalysis })

    fireEvent.click(screen.getByRole('button', { name: '重试故事分析' }))
    expect(onPrepareAnalysis).toHaveBeenCalledTimes(1)
  })

  it('formats all canonical coverage grammar in both locales', () => {
    const partialStatus: Status = {
      ...readyStatus,
      overall: 'partial',
      analysis: 'partial',
      search: 'partial',
      analysisCoverage: { kind: 'through', chapter: 5 },
      searchCoverage: { kind: 'range', start: 7, end: 9 },
    }
    const { rerender } = render(<WorkspaceKnowledgeStatus status={partialStatus} advancedDetailsOpen={false} onAdvancedDetailsChange={vi.fn()} onPrepareAnalysis={vi.fn()} onPrepareSearch={vi.fn()} />)
    expect(screen.getByText('至第 5 章')).toBeInTheDocument()
    expect(screen.getByText('第 7–9 章')).toBeInTheDocument()

    i18nState.locale = 'en'
    rerender(<WorkspaceKnowledgeStatus status={{ ...partialStatus, searchCoverage: { kind: 'count', covered: 4, total: 12 } }} advancedDetailsOpen={false} onAdvancedDetailsChange={vi.fn()} onPrepareAnalysis={vi.fn()} onPrepareSearch={vi.fn()} />)
    expect(screen.getByText('Through chapter 5')).toBeInTheDocument()
    expect(screen.getByText('4 of 12 chapters')).toBeInTheDocument()

    rerender(<WorkspaceKnowledgeStatus status={{ ...partialStatus, searchCoverage: { kind: 'partial' } }} advancedDetailsOpen={false} onAdvancedDetailsChange={vi.fn()} onPrepareAnalysis={vi.fn()} onPrepareSearch={vi.fn()} />)
    expect(screen.getByText('Partial coverage')).toBeInTheDocument()
  })

  it('toggles advanced details with the existing callback', () => {
    i18nState.locale = 'en'
    const onAdvancedDetailsChange = vi.fn()
    renderStatus(readyStatus, { onAdvancedDetailsChange })
    fireEvent.click(screen.getByRole('button', { name: /Advanced details/ }))
    expect(onAdvancedDetailsChange).toHaveBeenCalledWith(true)
  })
})
