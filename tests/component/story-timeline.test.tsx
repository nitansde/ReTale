// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoryTimeline } from '@/components/timeline/StoryTimeline'
import { storyBranchFixtureIds } from '@/tests/helpers/fixture-ids'
import type { StoryTimelineBranchNode, StoryTimelineEdge, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

const edgeTestId = `timeline-edge-${storyBranchFixtureIds.whatIfNodeId}-${storyBranchFixtureIds.futureJumpNodeId}`

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this
    },
  } as DOMRect
}

const originalResizeObserver = globalThis.ResizeObserver

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
    const testId = this.getAttribute('data-testid')
    if (testId === `timeline-node-${storyBranchFixtureIds.whatIfNodeId}`) return rect(560, 80, 224, 96)
    if (testId === `timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`) return rect(560, 236, 224, 96)
    return rect(0, 0, 920, 560)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.ResizeObserver = originalResizeObserver
})

function buildBranchChapter(): Chapter {
  return {
    id: 'branch-chapter-10-b1',
    novelId: 'novel-001',
    volumeId: 'volume-001',
    title: '第10章 结盟 · 分支 1',
    order: 10.1,
    content: '<p>branch</p>',
    status: 'draft',
    wordCount: 120,
    updatedAt: '2026-05-15',
    kind: 'branch',
    parentChapterId: 'chapter-10',
    branchLabel: 'B1',
  }
}

function buildNodes(): StoryTimelineBranchNode[] {
  return [
    {
      type: 'branch_node',
      id: storyBranchFixtureIds.whatIfNodeId,
      nodeType: 'what_if',
      anchorChapterNo: 10,
      parentNodeId: null,
      title: 'IF-01 决裂线',
      subtitle: '如果他们在这里闹翻',
      laneIndex: 0,
      colorToken: 'rose',
      sourceChapterNo: 10,
      targetChapterNo: null,
      continueBlockId: null,
      whatIfSessionId: 'what-if-session-001',
      futureJumpRunId: null,
      createdAt: '2026-05-15T01:21:00.000Z',
      status: 'active',
    },
    {
      type: 'branch_node',
      id: 'continue-node-1',
      nodeType: 'continue_block',
      anchorChapterNo: 10,
      parentNodeId: storyBranchFixtureIds.whatIfNodeId,
      title: 'CONT-01 续写块',
      subtitle: '沿着分支继续推进',
      laneIndex: 1,
      colorToken: 'fuchsia',
      sourceChapterNo: 10,
      targetChapterNo: null,
      continueBlockId: 'continue-block-001',
      whatIfSessionId: null,
      futureJumpRunId: null,
      latestText: '第二版子续写正文',
      latestRevisionNo: 2,
      createdAt: '2026-05-15T01:22:00.000Z',
      status: 'active',
    },
    {
      type: 'branch_node',
      id: storyBranchFixtureIds.futureJumpNodeId,
      nodeType: 'future_jump',
      anchorChapterNo: 100,
      parentNodeId: storyBranchFixtureIds.whatIfNodeId,
      title: 'JUMP-01 第100章',
      subtitle: '跳到被绑走后的未来',
      laneIndex: 1,
      colorToken: 'violet',
      sourceChapterNo: 10,
      targetChapterNo: 100,
      continueBlockId: null,
      whatIfSessionId: null,
      futureJumpRunId: 'jump-run-001',
      createdAt: '2026-05-15T01:23:00.000Z',
      status: 'generated',
    },
  ]
}

function buildMixedNodes(): StoryTimelineBranchNode[] {
  return [
    {
      type: 'branch_node',
      id: 'continue-node-2',
      nodeType: 'continue_block',
      anchorChapterNo: 100,
      parentNodeId: storyBranchFixtureIds.futureJumpNodeId,
      title: 'CONT-02 未来续写块',
      subtitle: '沿着未来跳转继续推进',
      laneIndex: 0,
      colorToken: 'fuchsia',
      sourceChapterNo: 100,
      targetChapterNo: null,
      continueBlockId: 'continue-block-002',
      whatIfSessionId: null,
      futureJumpRunId: null,
      latestText: '未来续写块正文',
      latestRevisionNo: 1,
      createdAt: '2026-05-15T01:24:00.000Z',
      status: 'active',
    },
    ...buildNodes(),
  ]
}

function buildMixedEdges(): StoryTimelineEdge[] {
  return [
    ...buildEdges(),
    { fromNodeId: storyBranchFixtureIds.futureJumpNodeId, toNodeId: 'continue-node-2' },
  ]
}

function buildEdges(): StoryTimelineEdge[] {
  return [
    { fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: 'continue-node-1' },
    { fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: storyBranchFixtureIds.futureJumpNodeId },
  ]
}

describe('StoryTimeline', () => {
  it('renders chapter cards, authored branch nodes, and the folded connector path', async () => {
    render(
      <StoryTimeline
        chapters={[
          { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
          { type: 'chapter', chapterNo: 100, chapterId: 'chapter-100', title: '第100章 被绑走', wordCount: 1900 },
        ]}
        branchNodes={buildNodes()}
        edges={buildEdges()}
        activeChapterId="chapter-10"
        activeSelection={{ kind: 'chapter', chapterId: 'chapter-10', chapterNo: 10 }}
        branchChaptersByParentId={new Map([['chapter-10', [buildBranchChapter()]]])}
        onSelectionChange={() => undefined}
        onDeleteChapter={() => undefined}
        onDeleteBranchChapter={() => undefined}
        deletingBranchNodeId={null}
        onDeleteWhatIfSession={() => undefined}
        onDeleteFutureJumpRun={() => undefined}
      />
    )

    expect(screen.getByTestId('timeline-chapter-10')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-chapter-100')).toBeInTheDocument()
    expect(screen.getByTestId(`timeline-node-${storyBranchFixtureIds.whatIfNodeId}`)).toBeInTheDocument()
    expect(screen.getByTestId('timeline-node-continue-node-1')).toBeInTheDocument()
    expect(screen.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)).toBeInTheDocument()
    expect(within(screen.getByTestId('timeline-chapter-10')).getByText('第10章 结盟 · 分支 1')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId(edgeTestId)).toBeInTheDocument()
    })

    expect(screen.getByTestId(edgeTestId)).toHaveAttribute('d')
  })

  it('emits the shared timeline selection payloads for chapter, what-if, and future-jump clicks', async () => {
    const onSelectionChange = vi.fn<(selection: TimelineSelection) => void>()

    render(
      <StoryTimeline
        chapters={[
          { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
          { type: 'chapter', chapterNo: 100, chapterId: 'chapter-100', title: '第100章 被绑走', wordCount: 1900 },
        ]}
        branchNodes={buildNodes()}
        edges={buildEdges()}
        activeChapterId="chapter-10"
        activeSelection={null}
        branchChaptersByParentId={new Map([['chapter-10', [buildBranchChapter()]]])}
        onSelectionChange={onSelectionChange}
        onDeleteChapter={() => undefined}
        onDeleteBranchChapter={() => undefined}
        deletingBranchNodeId={null}
        onDeleteWhatIfSession={() => undefined}
        onDeleteFutureJumpRun={() => undefined}
      />
    )

    fireEvent.click(within(screen.getByTestId('timeline-chapter-10')).getAllByRole('button')[0])
    fireEvent.click(screen.getByTestId(`timeline-node-${storyBranchFixtureIds.whatIfNodeId}`))
    fireEvent.click(screen.getByTestId('timeline-node-continue-node-1'))
    fireEvent.click(screen.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`))

    expect(onSelectionChange).toHaveBeenNthCalledWith(1, {
      kind: 'chapter',
      chapterId: 'chapter-10',
      chapterNo: 10,
    })
    expect(onSelectionChange).toHaveBeenNthCalledWith(2, {
      kind: 'what_if',
      nodeId: storyBranchFixtureIds.whatIfNodeId,
      sessionId: 'what-if-session-001',
      anchorChapterNo: 10,
    })
    expect(onSelectionChange).toHaveBeenNthCalledWith(3, {
      kind: 'continue_block',
      nodeId: 'continue-node-1',
      continueBlockId: 'continue-block-001',
      anchorChapterNo: 10,
    })
    expect(onSelectionChange).toHaveBeenNthCalledWith(4, {
      kind: 'future_jump',
      nodeId: storyBranchFixtureIds.futureJumpNodeId,
      runId: 'jump-run-001',
      sourceChapterNo: 10,
      targetChapterNo: 100,
    })
  })

  it('keeps mixed continue and future-jump descendants in parent-first chronological order with ancestry indentation', () => {
    render(
      <StoryTimeline
        chapters={[
          { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
          { type: 'chapter', chapterNo: 100, chapterId: 'chapter-100', title: '第100章 被绑走', wordCount: 1900 },
        ]}
        branchNodes={buildMixedNodes()}
        edges={buildMixedEdges()}
        activeChapterId="chapter-10"
        activeSelection={null}
        branchChaptersByParentId={new Map([['chapter-10', [buildBranchChapter()]]])}
        onSelectionChange={() => undefined}
        onDeleteChapter={() => undefined}
        onDeleteBranchChapter={() => undefined}
        deletingBranchNodeId={null}
        onDeleteWhatIfSession={() => undefined}
        onDeleteFutureJumpRun={() => undefined}
      />
    )

    const jumpNode = screen.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)
    const futureContinueNode = screen.getByTestId('timeline-node-continue-node-2')
    expect(jumpNode.compareDocumentPosition(futureContinueNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(futureContinueNode.parentElement).toHaveClass('lg:ml-10')
    expect(screen.getAllByText('Continue block')).toHaveLength(2)
  })
})
