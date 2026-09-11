import { progressMessage } from '@/lib/i18n/progress-message'
import { describe, expect, it } from 'vitest'
import { mapWorkspaceKnowledgeStatus } from '@/components/workspace/workspace-knowledge-status'
import { getMessage } from '@/lib/i18n/messages'
import type { KnowledgeRebuildStatus, KnowledgeStatusOverview } from '@/components/workspace/selection-novel-studio-helpers'

const coverage = {
  missing: { status: 'missing' as const, coveredChapterCount: 0, totalChapterCount: 12, validThroughChapterNo: null },
  partial: { status: 'partial' as const, coveredChapterCount: 8, totalChapterCount: 12, validThroughChapterNo: 5 },
  full: { status: 'full' as const, coveredChapterCount: 12, totalChapterCount: 12, validThroughChapterNo: 12 },
}

function overview(
  graph: 'missing' | 'partial' | 'full',
  search: 'missing' | 'pending' | 'partial' | 'full',
): KnowledgeStatusOverview {
  return {
    knowledgeGraph: coverage[graph],
    extractionCache: coverage[graph],
    embeddingCache: { ...coverage[graph], provider: null, model: null },
    retrievalIndex: { status: search, indexedScopeCount: search === 'missing' ? 0 : 5, task: null },
  }
}

function job(
  jobType: KnowledgeRebuildStatus['jobType'],
  status: string,
  overrides: Partial<KnowledgeRebuildStatus> = {},
): KnowledgeRebuildStatus {
  return {
    jobId: 'job-1',
    novelId: 'novel-1',
    jobType,
    status,
    progress: 0.95,
    currentStep: 'global backend phase',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etaMinutes: null,
    steps: [],
    ...overrides,
  }
}

describe('mapWorkspaceKnowledgeStatus', () => {
  it('uses the supplied locale for stored progress independently of browser document state', () => {
    const input = { overview: null, job: job('extract_chapter_knowledge', 'running', { currentStep: progressMessage('progress.extract') }) }
    expect(mapWorkspaceKnowledgeStatus(input, (key, values) => getMessage('en', key, values)).operation?.phaseLabel)
      .toBe('Extracting chapter knowledge')
    expect(mapWorkspaceKnowledgeStatus(input, (key, values) => getMessage('zh', key, values)).operation?.phaseLabel)
      .toBe('抽取章节知识')
  })

  it('returns loading only while the durable overview has not loaded', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: null, job: job('extract_chapter_knowledge', 'running') })).toMatchObject({
      overall: 'loading', analysis: 'not_ready', search: 'not_ready', operation: { stage: 'analysis', status: 'running' },
    })
  })

  it('keeps durable readiness independent while a refresh is running or failed', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'full'), job: job('extract_chapter_knowledge', 'running') })).toMatchObject({
      overall: 'ready', analysis: 'ready', search: 'ready', operation: { stage: 'analysis', status: 'running' },
    })
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'full'), job: job('extract_chapter_knowledge', 'failed') })).toMatchObject({
      overall: 'ready', analysis: 'ready', search: 'ready', operation: { stage: 'analysis', status: 'failed', progressPercent: null },
    })
  })

  it('uses active-step progress instead of the 95 percent global job progress', () => {
    const status = mapWorkspaceKnowledgeStatus({
      overview: overview('full', 'full'),
      job: job('extract_chapter_knowledge', 'running', {
        steps: [
          { key: 'hanlp-bootstrap', label: 'Bootstrap', status: 'completed', progress: 1, etaMinutes: null, detail: null },
          { key: 'extract', label: 'Extract', status: 'running', progress: 0.36, etaMinutes: 2, detail: 'Chapter extraction' },
        ],
      }),
    })

    expect(status.operation).toEqual({
      jobId: 'job-1',
      stage: 'analysis',
      status: 'running',
      phaseLabel: 'Chapter extraction',
      progressPercent: 36,
      progressSource: 'phase',
    })
  })

  it('does not expose determinate progress for queued work', () => {
    expect(mapWorkspaceKnowledgeStatus({
      overview: overview('full', 'full'),
      job: job('extract_chapter_knowledge', 'queued', { progress: 0.63 }),
    }).operation).toMatchObject({ status: 'queued', progressPercent: null, progressSource: null })
  })

  it('falls back to finite positive job progress when running work has no running step', () => {
    expect(mapWorkspaceKnowledgeStatus({
      overview: overview('full', 'full'),
      job: job('extract_chapter_knowledge', 'running', { progress: 0.63, steps: [] }),
    }).operation).toMatchObject({ status: 'running', progressPercent: 63, progressSource: 'job' })
  })

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('does not expose invalid or zero job progress %s without a running step', (progress) => {
    expect(mapWorkspaceKnowledgeStatus({
      overview: overview('full', 'full'),
      job: job('extract_chapter_knowledge', 'running', { progress, steps: [] }),
    }).operation).toMatchObject({ status: 'running', progressPercent: null, progressSource: null })
  })

  it('derives retrieval work independently and deduplicates an embedded copy of the top-level job', () => {
    const value = overview('full', 'partial')
    const retrievalJob = job('rebuild_retrieval_index', 'running', {
      jobId: 'retrieval-1',
      steps: [{ key: 'index', label: 'Index', status: 'running', progress: 0.42, etaMinutes: null, detail: null }],
    })
    value.retrievalIndex.task = retrievalJob

    expect(mapWorkspaceKnowledgeStatus({ overview: value, job: retrievalJob })).toMatchObject({
      overall: 'partial',
      operation: { jobId: 'retrieval-1', stage: 'search', status: 'running', progressPercent: 42, progressSource: 'phase' },
    })
  })

  it.each(['paused', 'failed'] as const)('keeps retained results and exposes no progress for %s work', (operationStatus) => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('partial', 'full'), job: job('extract_chapter_knowledge', operationStatus) })).toMatchObject({
      overall: 'partial',
      analysis: 'partial',
      search: 'ready',
      operation: { status: operationStatus, progressPercent: null, progressSource: null },
      analysisResultsUsable: true,
      searchResultsUsable: true,
    })
  })

  it.each(['completed', 'succeeded', 'aborted'] as const)('does not expose terminal %s work as a current operation', (operationStatus) => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'full'), job: job('extract_chapter_knowledge', operationStatus) }).operation).toBeNull()
  })

  it('uses validThroughChapterNo rather than covered count for graph continuity', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('partial', 'missing') }).analysisCoverage).toEqual({ kind: 'through', chapter: 5 })
  })

  it('maps canonical durable graph and retrieval coverage shapes', () => {
    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'full') })).toMatchObject({
      analysisCoverage: { kind: 'all', count: 12 },
      searchCoverage: { kind: 'all', count: 12 },
    })

    const through = overview('full', 'partial')
    through.retrievalIndex.chapterRange = { startChapter: 1, endChapter: 7 }
    expect(mapWorkspaceKnowledgeStatus({ overview: through }).searchCoverage).toEqual({ kind: 'through', chapter: 7 })

    const range = overview('full', 'partial')
    range.retrievalIndex.chapterRange = { startChapter: 4, endChapter: 9 }
    expect(mapWorkspaceKnowledgeStatus({ overview: range }).searchCoverage).toEqual({ kind: 'range', start: 4, end: 9 })

    expect(mapWorkspaceKnowledgeStatus({ overview: overview('full', 'partial') }).searchCoverage).toEqual({ kind: 'partial' })
  })
})
