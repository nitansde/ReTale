import { describe, expect, it } from 'vitest'
import { mapWorkspaceKnowledgeStatus } from '@/components/workspace/workspace-knowledge-status'
import type { KnowledgeRebuildStatus, KnowledgeStatusOverview } from '@/components/workspace/selection-novel-studio-helpers'

const coverage = {
  missing: { status: 'missing' as const, coveredChapterCount: 0, totalChapterCount: 12, validThroughChapterNo: null },
  partial: { status: 'partial' as const, coveredChapterCount: 5, totalChapterCount: 12, validThroughChapterNo: 5 },
  full: { status: 'full' as const, coveredChapterCount: 12, totalChapterCount: 12, validThroughChapterNo: 12 },
}

function overview(
  graph: 'missing' | 'partial' | 'full',
  search: 'missing' | 'pending' | 'partial' | 'full'
): KnowledgeStatusOverview {
  return {
    knowledgeGraph: coverage[graph],
    extractionCache: coverage[graph],
    embeddingCache: { ...coverage[graph], provider: null, model: null },
    retrievalIndex: { status: search, indexedScopeCount: search === 'missing' ? 0 : 5, task: null },
  }
}

function job(jobType: KnowledgeRebuildStatus['jobType'], status: string): KnowledgeRebuildStatus {
  return {
    jobId: 'job-1',
    novelId: 'novel-1',
    jobType,
    status,
    progress: 0,
    currentStep: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etaMinutes: null,
    steps: [],
  }
}

describe('mapWorkspaceKnowledgeStatus', () => {
  it('returns loading only while neither overview nor job has loaded', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: null })).toMatchObject({
      overall: 'loading', analysis: 'not_ready', search: 'not_ready', stage: null,
    })
  })

  it('maps queued and running work by job type before durable readiness', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'full'), job: job('extract_chapter_knowledge', 'queued') })).toMatchObject({
      overall: 'working_analysis', stage: 'analysis', previousResultsAvailable: true,
    })
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'partial'), job: job('rebuild_retrieval_index', 'running') })).toMatchObject({
      overall: 'working_search', stage: 'search', searchResultsUsable: true,
    })
  })

  it('keeps retained durable coverage visible when analysis work is paused or failed', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('partial', 'full'), job: job('extract_chapter_knowledge', 'paused') })).toEqual({
      overall: 'paused',
      analysis: 'partial',
      search: 'ready',
      stage: 'analysis',
      validThroughChapterNo: 5,
      totalChapterCount: 12,
      analysisResultsUsable: true,
      searchResultsUsable: true,
      previousResultsAvailable: true,
      searchMayBeStale: false,
    })
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'full'), job: job('extract_chapter_knowledge', 'failed') })).toMatchObject({
      overall: 'failed', analysis: 'ready', search: 'ready', previousResultsAvailable: true,
    })
  })

  it('keeps retained search coverage visible when search work is paused or failed', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'partial'), job: job('rebuild_retrieval_index', 'paused') })).toMatchObject({
      overall: 'paused', stage: 'search', search: 'partial', searchResultsUsable: true, previousResultsAvailable: true,
    })
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'partial'), job: job('rebuild_retrieval_index', 'failed') })).toMatchObject({
      overall: 'failed', stage: 'search', searchMayBeStale: true, previousResultsAvailable: true,
    })
  })

  it('reports ready only from full durable graph and retrieval coverage', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'full') })).toMatchObject({
      overall: 'ready', analysis: 'ready', search: 'ready', searchMayBeStale: false,
    })
  })

  it.each(['missing', 'pending'] as const)('separates ready analysis from %s search preparation', (search) => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', search) })).toMatchObject({
      overall: 'analysis_ready_search_not_ready', analysis: 'ready', search: search === 'missing' ? 'not_ready' : 'pending', searchMayBeStale: true,
    })
  })

  it('reports partial when either durable dimension has incomplete usable coverage', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('partial', 'missing') })).toMatchObject({
      overall: 'partial', analysis: 'partial', search: 'not_ready', validThroughChapterNo: 5,
    })
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('missing', 'partial') })).toMatchObject({
      overall: 'partial', analysis: 'not_ready', search: 'partial', searchResultsUsable: true,
    })
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'partial') })).toMatchObject({
      overall: 'partial', searchMayBeStale: true,
    })
  })

  it('reports not ready when loaded durable coverage is absent', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('missing', 'missing') })).toMatchObject({
      overall: 'not_ready', analysisResultsUsable: false, searchResultsUsable: false, previousResultsAvailable: false,
    })
  })

  it('uses the retrieval task embedded in the overview when no separate job is supplied', () => {
    const value = overview('full', 'pending')
    value.retrievalIndex.task = job('rebuild_retrieval_index', 'running')
    expect(mapWorkspaceKnowledgeStatus({ overview: value })).toMatchObject({ overall: 'working_search', stage: 'search' })
  })
})
