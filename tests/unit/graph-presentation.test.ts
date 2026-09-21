import { describe, expect, it } from 'vitest'
import { filterGraph, graphEdgeLabel, graphStatusLabel } from '@/components/graph/graph-presentation'
import { enMessages, getMessage, type TranslationKey, type TranslationValues } from '@/lib/i18n/messages'
import type { GraphNode, GraphEdge } from '@/lib/server/graph-types'

const t = (key: TranslationKey, values?: TranslationValues) => getMessage('zh', key, values)
const nodes: GraphNode[] = ['seed', 'confirmed', 'inferred', 'isolated'].map((id) => ({ id, label: id === 'seed' ? '林砚' : id, entityType: 'character', importance: 2, confidence: 0.9, userConfirmed: id === 'confirmed', score: 1, aliases: id === 'seed' ? ['阿砚'] : [] }))
const edges: GraphEdge[] = [
  { id: 'one', source: 'seed', target: 'confirmed', linkType: 'ally', confidence: 0.9, status: 'user_confirmed', hop: 1 },
  { id: 'two', source: 'seed', target: 'inferred', linkType: 'enemy', confidence: 0.3, status: 'user_confirmed', hop: 2 },
].map((edge) => ({ strength: 1, validFromChapter: 1, validUntilChapter: 99999, score: 1, includeInPrompt: true, ...edge })) as GraphEdge[]
const controls = { maxHops: 2 as const, hideLowConfidence: false, confirmedOnly: false, showPotentiallyStale: true }

describe('graph presentation', () => {
  it('keeps English graph interface copy free of untranslated Chinese labels', () => {
    const graphMessages = Object.entries(enMessages).filter(([key]) => key.startsWith('graph.'))
    expect(graphMessages.every(([, value]) => !/[\p{Script=Han}]/u.test(value))).toBe(true)
  })
  it('keeps isolated nodes and never produces edges whose endpoints are hidden', () => {
    expect(filterGraph(nodes, edges, ['seed'], controls, '', t).nodes).toHaveLength(4)
    const confirmed = filterGraph(nodes, edges, ['seed'], { ...controls, confirmedOnly: true }, '', t)
    expect(confirmed.nodes.map((node) => node.id)).toEqual(['seed', 'confirmed'])
    expect(confirmed.edges.map((edge) => edge.id)).toEqual(['one'])
  })
  it('applies hop, confidence and stale filters to both views', () => {
    expect(filterGraph(nodes, edges, ['seed'], { ...controls, maxHops: 1 }, '', t).edges).toHaveLength(1)
    expect(filterGraph(nodes, edges, ['seed'], { ...controls, hideLowConfidence: true }, '', t).edges).toHaveLength(1)
    expect(filterGraph(nodes, [{ ...edges[0], status: 'potentially_stale' }], ['seed'], { ...controls, showPotentiallyStale: false }, '', t).edges).toHaveLength(0)
  })
  it('searches aliases and translated relationships while retaining endpoint context', () => {
    expect(filterGraph(nodes, edges, ['seed'], controls, '阿砚', t).edges).toHaveLength(2)
    const result = filterGraph(nodes, edges, ['seed'], controls, '盟友', t)
    expect(result.edges.map((edge) => edge.id)).toEqual(['one'])
    expect(result.nodes.map((node) => node.id)).toEqual(['seed', 'confirmed'])
    expect(filterGraph(nodes, edges, ['seed'], controls, '不存在', t).nodes).toEqual([])
  })
  it('translates system values while preserving custom story labels', () => {
    expect(graphEdgeLabel(edges[0], t)).toBe('盟友')
    expect(graphEdgeLabel({ ...edges[0], label: 'A promise under the moon' }, t)).toBe('A promise under the moon')
    expect(graphStatusLabel('active', t)).toBe('活跃')
    expect(graphStatusLabel('正在闭关', t)).toBe('正在闭关')
  })
})
