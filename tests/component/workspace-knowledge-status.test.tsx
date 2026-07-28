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
  stage: null,
  validThroughChapterNo: 12,
  totalChapterCount: 12,
  analysisResultsUsable: true,
  searchResultsUsable: true,
  previousResultsAvailable: true,
  searchMayBeStale: false,
}

describe('WorkspaceKnowledgeStatus', () => {
  beforeEach(() => { i18nState.locale = 'zh' })

  it('shows two compact user-facing dimensions without technical telemetry', () => {
    render(<WorkspaceKnowledgeStatus status={readyStatus} advancedDetailsOpen={false} onAdvancedDetailsChange={vi.fn()} onPrepareAnalysis={vi.fn()} onPrepareSearch={vi.fn()} />)

    const summary = screen.getByTestId('workspace-knowledge-status')
    expect(summary).toHaveTextContent('故事分析')
    expect(summary).toHaveTextContent('内容检索准备')
    expect(summary).toHaveTextContent('已准备至第 12 章')
    expect(summary).not.toHaveTextContent(/HanLP|LLM|Embedding|LanceDB|provider|model|%|errorMessage|currentStep/i)
  })

  it('offers search preparation when analysis is ready but search is stale', () => {
    const onPrepareSearch = vi.fn()
    render(
      <WorkspaceKnowledgeStatus
          status={{ ...readyStatus, overall: 'analysis_ready_search_not_ready', search: 'not_ready', searchResultsUsable: false, searchMayBeStale: true }}
          advancedDetailsOpen={false}
          onAdvancedDetailsChange={vi.fn()}
          onPrepareAnalysis={vi.fn()}
          onPrepareSearch={onPrepareSearch}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '准备内容检索' }))
    expect(onPrepareSearch).toHaveBeenCalledTimes(1)
  })

  it('uses generic failure copy while confirming retained results remain usable', () => {
    render(
      <WorkspaceKnowledgeStatus
          status={{ ...readyStatus, overall: 'failed', stage: 'analysis' }}
          advancedDetailsOpen={false}
          onAdvancedDetailsChange={vi.fn()}
          onPrepareAnalysis={vi.fn()}
          onPrepareSearch={vi.fn()}
      />
    )

    expect(screen.getByText('本次准备未完成')).toBeInTheDocument()
    expect(screen.getByText('之前已完成的结果仍可继续使用。')).toBeInTheDocument()
  })

  it('renders localized English labels and toggles advanced details', () => {
    i18nState.locale = 'en'
    const onAdvancedDetailsChange = vi.fn()
    render(<WorkspaceKnowledgeStatus status={readyStatus} advancedDetailsOpen={false} onAdvancedDetailsChange={onAdvancedDetailsChange} onPrepareAnalysis={vi.fn()} onPrepareSearch={vi.fn()} />)

    expect(screen.getByText('Story analysis')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Advanced details/ }))
    expect(onAdvancedDetailsChange).toHaveBeenCalledWith(true)
  })
})
