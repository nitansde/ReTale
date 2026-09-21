// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GraphReviewPanel } from '@/components/graph/graph-review-panel'
import type { GraphSelection } from '@/components/graph/types'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import { I18nProvider } from '@/lib/i18n/provider'

vi.mock('@/components/graph/graph-flow-canvas', () => ({ GraphFlowCanvas: () => null }))
beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const nodes: GraphNode[] = ['林砚', '苏九'].map((label) => ({ id: label, label, entityType: 'character', status: 'active', importance: 3, confidence: 0.9, userConfirmed: true, score: 5 }))
const edge: GraphEdge = { id: 'ally', source: '林砚', target: '苏九', linkType: 'ally', polarity: 'positive', strength: 3, confidence: 0.9, validFromChapter: 1, validUntilChapter: 2147483647, status: 'ai_generated', hop: 1, score: 5, includeInPrompt: true, evidenceQuote: '两人约定一同调查。' }

it('keeps mobile review, editing and source actions available inside the localized details sheet', () => {
  const confirm = vi.fn(), reject = vi.fn(), exclude = vi.fn(), save = vi.fn(), jump = vi.fn()
  function Review() {
    const [selection, setSelection] = useState<GraphSelection>(null)
    return <I18nProvider initialLocale="zh" localeCookiePresent><GraphReviewPanel
      context={{ novelId: 'novel', branchId: 'main', chapterId: 'chapter', chapterNo: 1, selectedLineStart: 1, selectedLineEnd: 2, warnings: [], promptBlocks: [], assembledContext: '', graphContext: { nodes, edges: [edge], seedEntities: [nodes[0]], contextText: '', warnings: [], tokenEstimate: 1, status: 'ready' }, lanceEvidence: [], tokenEstimate: 1 }}
      graphNodes={nodes} graphEdges={[edge]} selection={selection} controls={{ maxHops: 2, hideLowConfidence: false, confirmedOnly: false, showPotentiallyStale: true }} loading={false} error=""
      disabledBlockIds={[]} excludedEdgeIds={[]} excludedEvidenceIds={[]} edgeMutationPending={false} edgeMutationError=""
      onSelectNode={(node) => setSelection({ type: 'node', node })} onSelectEdge={(edge) => setSelection({ type: 'edge', edge })} onClearSelection={() => setSelection(null)}
      onTogglePromptBlock={vi.fn()} onConfirmEdge={confirm} onRejectEdge={reject} onSaveEdgeEdit={save} onToggleEdgeExcluded={exclude} onToggleNodeExcluded={vi.fn()} onToggleEvidenceExcluded={vi.fn()} onChangeControls={vi.fn()} onJumpToEdgeSource={jump} canJumpToEdgeSource={() => true} onJumpToEvidenceSource={vi.fn()} canJumpToEvidenceSource={() => true} onRefresh={vi.fn()}
    /></I18nProvider>
  }
  render(<Review />)
  fireEvent.click(screen.getByRole('button', { name: '林砚 人物' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '林砚 人物' })).toHaveAttribute('aria-pressed', 'true')
  const card = screen.getByTestId('graph-relation-card')
  fireEvent.click(card)
  const dialog = screen.getByRole('dialog', { name: '图谱详情' })
  expect(within(dialog).getByText('盟友', { exact: true })).toBeVisible()
  expect(within(dialog).getAllByText(edge.evidenceQuote!)).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole('button', { name: '确认关系' }))
  expect(confirm).toHaveBeenCalledWith(edge)
  fireEvent.click(within(dialog).getByRole('button', { name: '拒绝关系' }))
  expect(reject).toHaveBeenCalledWith(edge)
  fireEvent.click(within(dialog).getByRole('button', { name: '排除本次生成' }))
  expect(exclude).toHaveBeenCalledWith(edge, true)
  fireEvent.click(within(dialog).getByRole('button', { name: '跳转原文' }))
  expect(jump).toHaveBeenCalledWith(edge)
  fireEvent.click(within(dialog).getByRole('button', { name: '编辑关系' }))
  const polarity = within(dialog).getByRole('combobox')
  expect(within(polarity).getByRole('option', { name: '正向' })).toBeVisible()
  fireEvent.change(polarity, { target: { value: 'mixed' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }))
  expect(save).toHaveBeenCalledWith(edge, expect.objectContaining({ polarity: 'mixed', linkType: 'ally' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭详情' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(card).toBeVisible()
})
