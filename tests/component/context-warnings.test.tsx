// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextWarningButton } from '@/components/graph/context-warning-button'
import { buildContextWarnings, formatContextWarning } from '@/lib/context-warnings'
import { I18nProvider, useI18n } from '@/lib/i18n/provider'
import type { KnowledgeStatusOverview } from '@/components/workspace/selection-novel-studio-helpers'

const indexWarning = 'Lance retrieval index is missing or stale for this branch; rebuild knowledge to refresh retrieval evidence.'
function overview(): KnowledgeStatusOverview {
  const full = { status: 'full' as const, coveredChapterCount: 10, totalChapterCount: 10, validThroughChapterNo: 10 }
  return {
    knowledgeGraph: full, extractionCache: full,
    embeddingCache: { ...full, provider: 'test', model: 'test' },
    retrievalIndex: { status: 'full', indexedScopeCount: 1, task: null },
  }
}
function SwitchLanguage() {
  const { locale, setLocale } = useI18n()
  return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Switch language</button>
}
afterEach(cleanup)

describe('context warnings', () => {
  it('hides compatibility diagnostics but retains actionable context warnings', () => {
    const diagnostics = [
      'Preset field `top_k` was preserved for export but not applied to openai-compatible.',
      'Preset image field `inline_image_quality` was preserved for export but not applied to openai-compatible.',
      'Preset extension `SPreset` was preserved for export but not applied to openai-compatible.',
      'Prompt formatting field `names_behavior` was preserved but not applied because runtime reason `NO_CHAT_HISTORY` blocked it on surface `roleplay`.',
      'Prompt rule `Chat History` was active but skipped because its content was empty.',
    ]
    expect(buildContextWarnings({ warnings: [...diagnostics, indexWarning] }, 'zh')).toEqual([formatContextWarning(indexWarning, 'zh')])
    render(<ContextWarningButton warnings={diagnostics} />)
    expect(screen.queryByTestId('workspace-context-warning-toggle')).not.toBeInTheDocument()
  })

  it('translates existing English and Chinese backend warnings in both directions', () => {
    expect(formatContextWarning(indexWarning, 'zh')).toContain('检索索引尚未建立或已过期')
    expect(formatContextWarning(indexWarning, 'en')).toContain('missing or outdated')
    expect(formatContextWarning('GraphRAG 未命中明确实体，已降级为空图谱上下文。', 'en')).toContain('No clear characters')
    expect(formatContextWarning('当前章节在知识图谱里还没有可用的实体出场记录。', 'en')).toContain('no entity appearances')
    expect(formatContextWarning('Graph subgraph 请求缺少 entityIds。', 'en')).toContain('No graph entities')
    expect(formatContextWarning('以下实体在当前章节之前不可用，已跳过：entity-1', 'en')).toContain('skipped: entity-1')
  })

  it('shows partial knowledge and embeddings, and prefers a pending index over the cached stale warning', () => {
    const status = overview()
    status.knowledgeGraph = { ...status.knowledgeGraph, status: 'partial', coveredChapterCount: 4 }
    status.embeddingCache = { ...status.embeddingCache, status: 'partial', coveredChapterCount: 3 }
    status.retrievalIndex.status = 'pending'
    const issues = buildContextWarnings({ overview: status, warnings: [indexWarning, indexWarning] }, 'zh')
    expect(issues).toHaveLength(3)
    expect(issues[0]).toContain('4 / 10')
    expect(issues[1]).toContain('3 / 10')
    expect(issues[2]).toContain('正在排队或建立中')
    expect(issues.join('')).not.toContain('已过期')
  })

  it('deduplicates overlapping graph warnings and preserves a branch-specific stale index warning even with full coverage', () => {
    expect(buildContextWarnings({ overview: overview(), warnings: [indexWarning, indexWarning] }, 'en')).toHaveLength(1)
    expect(buildContextWarnings({ overview: overview(), warnings: [] }, 'zh')).toEqual([])
    expect(buildContextWarnings({ overview: null, warnings: [] }, 'zh')).toEqual([])
  })

  it('shows a warning button without expanded context and switches open details immediately with the UI language', () => {
    render(<I18nProvider initialLocale="zh" localeCookiePresent>
      <SwitchLanguage />
      <ContextWarningButton warnings={[indexWarning]} />
    </I18nProvider>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看 1 项上下文警告' }))
    expect(screen.getByRole('dialog', { name: '上下文准备情况' })).toBeVisible()
    expect(screen.getByText(/这些问题不影响继续魔改，但可能影响写作质量/)).toBeVisible()
    expect(screen.getByText(/当前分支的检索索引尚未建立或已过期/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }))
    expect(screen.getByRole('dialog', { name: 'Context readiness' })).toBeVisible()
    expect(screen.getByText(/do not prevent rewriting, but may affect writing quality/)).toBeVisible()
    expect(screen.getByText(/The retrieval index for this branch is missing or outdated/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('removes the warning button when live coverage becomes complete', () => {
    const status = overview()
    status.retrievalIndex.status = 'partial'
    const { rerender } = render(<ContextWarningButton warnings={[]} overview={status} />)
    expect(screen.getByTestId('workspace-context-warning-toggle')).toBeVisible()
    rerender(<ContextWarningButton warnings={[]} overview={overview()} />)
    expect(screen.queryByTestId('workspace-context-warning-toggle')).not.toBeInTheDocument()
  })
})
