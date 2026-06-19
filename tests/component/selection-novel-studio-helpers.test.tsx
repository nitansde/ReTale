// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callGetRecoverableRewriteJobApi,
  resolveChapterListTargetForAnchorVisibility,
  upsertOptimisticContinueBlockTimelineNode,
} from '@/components/workspace/selection-novel-studio-helpers'
import type { StoryTimelineBranchNode, StoryTimelineResponse } from '@/lib/story-branch-types'

describe('callGetRecoverableRewriteJobApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('includes novel, branch, and chapter scope when querying by jobId', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true, job: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await callGetRecoverableRewriteJobApi({
      jobId: 'job-rewrite-1',
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      chapterId: 'chapter-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rewrite?jobId=job-rewrite-1&novelId=novel-1&branchId=novel-1%3Amain&chapterId=chapter-1',
      { cache: 'no-store' },
    )
  })

  it('still supports chapter-scoped restore without jobId', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true, job: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await callGetRecoverableRewriteJobApi({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      chapterId: 'chapter-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rewrite?novelId=novel-1&branchId=novel-1%3Amain&chapterId=chapter-1',
      { cache: 'no-store' },
    )
  })
})

describe('selection novel studio optimistic timeline helpers', () => {
  it('expands the chapter list target enough to reveal the anchor chapter inside its volume', () => {
    expect(resolveChapterListTargetForAnchorVisibility({
      anchorChapterNo: 95,
      currentTarget: 80,
      sortedChapters: [
        ...Array.from({ length: 120 }, (_, index) => ({ id: `volume-1-chapter-${index + 1}`, order: index + 1, volumeId: 'volume-1', parentChapterId: null })),
        { id: 'branch-chapter-95-a', order: 95, volumeId: 'volume-1', parentChapterId: 'volume-1-chapter-95' },
        ...Array.from({ length: 10 }, (_, index) => ({ id: `volume-2-chapter-${index + 1}`, order: 1000 + index + 1, volumeId: 'volume-2', parentChapterId: null })),
      ],
    })).toBe(95)
  })

  it('upserts the optimistic continue node by continueBlockId and rebuilds edges without duplicates', () => {
    const current: StoryTimelineResponse = {
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      chapters: [{ type: 'chapter', chapterId: 'chapter-1', chapterNo: 1, title: 'Chapter 1', wordCount: 100 }],
      branchNodes: [
        {
          type: 'branch_node',
          id: 'rewrite-node-1',
          nodeType: 'rewrite',
          readableLabel: 'RE-01',
          readableLineageLabel: 'RE-01',
          anchorChapterNo: 1,
          parentNodeId: null,
          title: 'Rewrite root',
          subtitle: 'Root node',
          laneIndex: 0,
          colorToken: 'fuchsia',
          sourceChapterNo: 1,
          targetChapterNo: null,
          continueBlockId: 'rewrite-block-1',
          whatIfSessionId: null,
          futureJumpRunId: null,
          roleplaySessionId: null,
          latestText: 'Root text',
          latestRevisionNo: 1,
          userInstruction: 'Rewrite root',
          selectedText: 'Selected root',
          originalText: 'Original root',
          inputTokens: 111,
          outputTokens: 222,
          createdAt: '2026-06-19T00:00:00.000Z',
          updatedAt: '2026-06-19T00:00:00.000Z',
          status: 'active',
        },
        {
          type: 'branch_node',
          id: 'continue-node-old',
          nodeType: 'continue_block',
          readableLabel: 'CONT-01',
          readableLineageLabel: 'RE-01, CONT-01',
          anchorChapterNo: 1,
          parentNodeId: 'rewrite-node-1',
          title: 'Old continue block',
          subtitle: 'Previous version',
          laneIndex: 1,
          colorToken: 'fuchsia',
          sourceChapterNo: 1,
          targetChapterNo: null,
          continueBlockId: 'continue-block-1',
          whatIfSessionId: null,
          futureJumpRunId: null,
          roleplaySessionId: null,
          latestText: 'Old text',
          latestRevisionNo: 1,
          userInstruction: 'Continue old',
          selectedText: 'Selected old',
          originalText: 'Original old',
          inputTokens: 10,
          outputTokens: 20,
          createdAt: '2026-06-19T00:01:00.000Z',
          updatedAt: '2026-06-19T00:01:00.000Z',
          status: 'active',
        },
      ],
      edges: [{ fromNodeId: 'rewrite-node-1', toNodeId: 'continue-node-old' }],
    }

    const nextNode: StoryTimelineBranchNode = {
      ...current.branchNodes[1],
      id: 'continue-node-new',
      title: 'Updated continue block',
      latestText: 'New text',
      latestRevisionNo: 2,
      updatedAt: '2026-06-19T00:02:00.000Z',
      status: 'revised',
    }

    const updated = upsertOptimisticContinueBlockTimelineNode(current, nextNode)

    expect(updated?.branchNodes).toHaveLength(2)
    expect(updated?.branchNodes.find((node) => node.continueBlockId === 'continue-block-1')?.id).toBe('continue-node-new')
    expect(updated?.edges).toEqual([{ fromNodeId: 'rewrite-node-1', toNodeId: 'continue-node-new' }])
  })
})
