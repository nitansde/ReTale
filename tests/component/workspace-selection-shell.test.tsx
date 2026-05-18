// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceCenterPane } from '@/components/workspace/WorkspaceCenterPane'
import {
  readWorkspaceSelectionFromSearchParams,
  resolveWorkspaceSelection,
  writeWorkspaceSelectionToSearchParams,
} from '@/components/workspace/workspace-selection'
import type { StoryTimelineBranchNode, TimelineSelection } from '@/lib/story-branch-types'

const branchNodes: StoryTimelineBranchNode[] = [
  {
    type: 'branch_node',
    id: 'if-node-1',
    nodeType: 'what_if',
    anchorChapterNo: 10,
    parentNodeId: null,
    title: 'IF-01 决裂线',
    subtitle: '如果在这里闹翻',
    laneIndex: 0,
    colorToken: 'rose',
    sourceChapterNo: 10,
    targetChapterNo: null,
    continueBlockId: null,
    whatIfSessionId: 'what-if-session-1',
    futureJumpRunId: null,
    status: 'active',
  },
  {
    type: 'branch_node',
    id: 'continue-node-1',
    nodeType: 'continue_block',
    anchorChapterNo: 10,
    parentNodeId: 'if-node-1',
    title: 'CONT-01 续写块',
    subtitle: '沿着分支继续推进',
    laneIndex: 1,
    colorToken: 'fuchsia',
    sourceChapterNo: 10,
    targetChapterNo: null,
    continueBlockId: 'continue-block-1',
    whatIfSessionId: null,
    futureJumpRunId: null,
    status: 'active',
  },
  {
    type: 'branch_node',
    id: 'jump-node-1',
    nodeType: 'future_jump',
    anchorChapterNo: 100,
    parentNodeId: 'if-node-1',
    title: 'JUMP-01 第100章',
    subtitle: '跳到未来',
    laneIndex: 1,
    colorToken: 'sky',
    sourceChapterNo: 10,
    targetChapterNo: 100,
    continueBlockId: null,
    whatIfSessionId: null,
    futureJumpRunId: 'jump-run-1',
    status: 'generated',
  },
]

function renderPane(selection: TimelineSelection) {
  const onCenterPaneViewChange = vi.fn<(view: 'body' | 'graph') => void>()

  render(
    <WorkspaceCenterPane
      selection={selection}
      chapterTitle="第10章 结盟"
      centerPaneView="body"
      onCenterPaneViewChange={onCenterPaneViewChange}
      chapterSelectionSummary="当前选区：未选择"
      chapterGraphSummary="当前浏览：章节图谱"
      chapterBodyView={<div data-testid="chapter-body-view">body</div>}
      chapterGraphView={<div data-testid="chapter-graph-view">graph</div>}
      continueBlockView={<div data-testid="continue-block-slot">continue-block seam</div>}
      whatIfView={<div data-testid="what-if-slot">what-if seam</div>}
      futureJumpView={<div data-testid="future-jump-slot">future-jump seam</div>}
    />
  )

  return { onCenterPaneViewChange }
}

describe('workspace selection shell', () => {
  it('keeps branch selections when the authored node still exists and falls back to chapter when it does not', () => {
    expect(resolveWorkspaceSelection({
      currentSelection: {
        kind: 'what_if',
        nodeId: 'stale-if-node',
        sessionId: 'what-if-session-1',
        anchorChapterNo: 10,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      branchNodes,
    })).toEqual({
      kind: 'what_if',
      nodeId: 'if-node-1',
      sessionId: 'what-if-session-1',
      anchorChapterNo: 10,
    })

    expect(resolveWorkspaceSelection({
      currentSelection: {
        kind: 'continue_block',
        nodeId: 'stale-continue-node',
        continueBlockId: 'continue-block-1',
        anchorChapterNo: 10,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      branchNodes,
    })).toEqual({
      kind: 'continue_block',
      nodeId: 'continue-node-1',
      continueBlockId: 'continue-block-1',
      anchorChapterNo: 10,
    })

    expect(resolveWorkspaceSelection({
      currentSelection: {
        kind: 'future_jump',
        nodeId: 'stale-jump-node',
        runId: 'jump-run-1',
        sourceChapterNo: 10,
        targetChapterNo: 100,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      branchNodes,
    })).toEqual({
      kind: 'future_jump',
      nodeId: 'jump-node-1',
      runId: 'jump-run-1',
      sourceChapterNo: 10,
      targetChapterNo: 100,
    })

    expect(resolveWorkspaceSelection({
      currentSelection: {
        kind: 'future_jump',
        nodeId: 'missing-jump',
        runId: 'missing-run',
        sourceChapterNo: 10,
        targetChapterNo: 100,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      branchNodes,
    })).toEqual({
      kind: 'chapter',
      chapterId: 'chapter-10',
      chapterNo: 10,
    })

    expect(resolveWorkspaceSelection({
      currentSelection: {
        kind: 'future_jump',
        nodeId: 'missing-jump',
        runId: 'jump-run-1',
        sourceChapterNo: 10,
        targetChapterNo: 100,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      branchNodes,
    })).toEqual({
      kind: 'future_jump',
      nodeId: 'jump-node-1',
      runId: 'jump-run-1',
      sourceChapterNo: 10,
      targetChapterNo: 100,
    })
  })

  it('round-trips chapter, what-if, and future-jump selections through URL search params', () => {
    const whatIfSearch = writeWorkspaceSelectionToSearchParams(new URLSearchParams('foo=bar'), {
      kind: 'what_if',
      nodeId: 'if-node-1',
      sessionId: 'what-if-session-1',
      anchorChapterNo: 10,
    })
    expect(whatIfSearch.get('foo')).toBe('bar')
    expect(readWorkspaceSelectionFromSearchParams(whatIfSearch)).toEqual({
      kind: 'what_if',
      nodeId: 'if-node-1',
      sessionId: 'what-if-session-1',
      anchorChapterNo: 10,
    })

    const continueBlockSearch = writeWorkspaceSelectionToSearchParams(whatIfSearch, {
      kind: 'continue_block',
      nodeId: 'continue-node-1',
      continueBlockId: 'continue-block-1',
      anchorChapterNo: 10,
    })
    expect(readWorkspaceSelectionFromSearchParams(continueBlockSearch)).toEqual({
      kind: 'continue_block',
      nodeId: 'continue-node-1',
      continueBlockId: 'continue-block-1',
      anchorChapterNo: 10,
    })

    const futureJumpSearch = writeWorkspaceSelectionToSearchParams(continueBlockSearch, {
      kind: 'future_jump',
      nodeId: 'jump-node-1',
      runId: 'jump-run-1',
      sourceChapterNo: 10,
      targetChapterNo: 100,
    })
    expect(readWorkspaceSelectionFromSearchParams(futureJumpSearch)).toEqual({
      kind: 'future_jump',
      nodeId: 'jump-node-1',
      runId: 'jump-run-1',
      sourceChapterNo: 10,
      targetChapterNo: 100,
    })

    const chapterSearch = writeWorkspaceSelectionToSearchParams(futureJumpSearch, {
      kind: 'chapter',
      chapterId: 'chapter-10',
      chapterNo: 10,
    })
    expect(readWorkspaceSelectionFromSearchParams(chapterSearch)).toEqual({
      kind: 'chapter',
      chapterId: 'chapter-10',
      chapterNo: 10,
    })
  })

  it('shows body/graph toggles only for chapter mode', () => {
    const { onCenterPaneViewChange } = renderPane({
      kind: 'chapter',
      chapterId: 'chapter-10',
      chapterNo: 10,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Graph' }))

    expect(screen.getByTestId('chapter-body-view')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-chapter-view-toggle')).toBeInTheDocument()
    expect(onCenterPaneViewChange).toHaveBeenCalledWith('graph')
  })

  it('switches to what-if and future-jump seams without showing chapter controls', () => {
    const whatIf = renderPane({
      kind: 'what_if',
      nodeId: 'if-node-1',
      sessionId: 'what-if-session-1',
      anchorChapterNo: 10,
    })

    expect(screen.getByTestId('what-if-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-chapter-view-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-center-pane-kind')).toHaveTextContent('What-if session workspace')
    expect(whatIf.onCenterPaneViewChange).not.toHaveBeenCalled()
    cleanup()

    renderPane({
      kind: 'continue_block',
      nodeId: 'continue-node-1',
      continueBlockId: 'continue-block-1',
      anchorChapterNo: 10,
    })

    expect(screen.getByTestId('continue-block-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-chapter-view-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-center-pane-kind')).toHaveTextContent('续写块工作区')
    expect(screen.getByText(/默认停留在干净的 reader 视图里/)).toBeInTheDocument()
    expect(screen.getByText('Selection-driven branch view')).toBeInTheDocument()
    cleanup()

    renderPane({
      kind: 'future_jump',
      nodeId: 'jump-node-1',
      runId: 'jump-run-1',
      sourceChapterNo: 10,
      targetChapterNo: 100,
    })

    expect(screen.getByTestId('future-jump-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-chapter-view-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-center-pane-kind')).toHaveTextContent('Future jump workspace')
  })
})
