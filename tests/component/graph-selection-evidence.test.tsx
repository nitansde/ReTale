// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getSelectionEvidence, GraphSelectionEvidence } from '@/components/graph/graph-selection-evidence'
import type { GenerationContextEvidence } from '@/components/graph/types'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'

afterEach(cleanup)
const node: GraphNode = { id: 'lin', label: '林砚', entityType: 'character', importance: 1, confidence: 0.9, userConfirmed: true, score: 1 }
const edge: GraphEdge = { id: 'ally', source: 'lin', target: 'su', linkType: 'ally', strength: 3, confidence: 0.9, validFromChapter: 1, validUntilChapter: 9999, status: 'user_confirmed', hop: 1, score: 1, includeInPrompt: true, evidenceQuote: '两人共同查案。', evidenceLocation: { chapterNo: 1, lineStart: 1, lineEnd: 2 } }
const unrelated = { ...edge, id: 'unrelated', source: 'other', target: 'city', evidenceQuote: '另一个人的故事。' }
const evidence: GenerationContextEvidence[] = [
  { id: 'relationship:ally', sourceType: 'relationship', sourceId: 'ally', text: '关系摘要，包括两人共同查案。' },
  { id: 'entity-profile:lin:1:0', sourceType: 'entity_profile', sourceId: 'profile-fact', text: '林砚的人物资料。' },
  { id: 'summary', sourceType: 'chapter_summary', sourceId: 'chapter', text: '同章的无关摘要。' },
  { id: 'relationship:unrelated', sourceType: 'relationship', sourceId: 'unrelated', text: '另一个人的关系摘要。' },
].map((item) => ({ chapterId: 'chapter', chapterNo: 1, lineStart: null, lineEnd: null, title: null, sourceLabel: '', score: 1, ...item })) as GenerationContextEvidence[]

it('scopes evidence by source identity, deduplicates relationship citations and includes connected evidence for entities', () => {
  const relation = getSelectionEvidence({ type: 'edge', edge }, [edge, unrelated], evidence)
  expect(relation).toHaveLength(1)
  expect(relation[0]).toMatchObject({ text: edge.evidenceQuote, item: evidence[0] })
  const person = getSelectionEvidence({ type: 'node', node }, [edge, unrelated], evidence)
  expect(person.map((item) => item.text)).toEqual([edge.evidenceQuote, evidence[1].text])
  expect(getSelectionEvidence(null, [edge], evidence)).toEqual([])
})

it('keeps source navigation and evidence exclusion beside the matching quote', () => {
  const jump = vi.fn(), toggle = vi.fn()
  const props = { selection: { type: 'edge' as const, edge }, edges: [edge], evidence, nodeById: new Map([[node.id, node]]), onJumpToEdgeSource: jump, canJumpToEdgeSource: () => true, onToggleEvidenceExcluded: toggle }
  const { rerender } = render(<GraphSelectionEvidence {...props} />)
  expect(screen.getByText(edge.evidenceQuote!)).toBeVisible()
  expect(screen.queryByText(evidence[2].text)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '跳转原文' }))
  expect(jump).toHaveBeenCalledWith(edge)
  fireEvent.click(screen.getByRole('button', { name: '排除本次生成' }))
  expect(toggle).toHaveBeenCalledWith(evidence[0], true)
  rerender(<GraphSelectionEvidence {...props} selection={{ type: 'edge', edge: { ...unrelated, evidenceQuote: undefined, evidenceLocation: undefined } }} evidence={[]} />)
  expect(screen.queryByText(edge.evidenceQuote!)).not.toBeInTheDocument()
  expect(screen.getByText('暂时没有与当前对象对应的证据。')).toBeVisible()
})
