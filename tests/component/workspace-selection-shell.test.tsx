// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getVisibleAdvancedContextPromptBlocks } from '@/components/graph/graph-review-panel'
import { WorkspaceCenterPane } from '@/components/workspace/WorkspaceCenterPane'
import {
  resolveContinueBlockSelectionAfterSave,
  resolveCurrentNodeMetrics,
  shouldLoadWorkspaceFromBackendOnMount,
} from '@/components/workspace/selection-novel-studio'
import {
  readWorkspaceSelectionFromSearchParams,
  resolveSelectionAfterDeletedBranchNode,
  resolveWorkspaceSelection,
  writeWorkspaceSelectionToSearchParams,
} from '@/components/workspace/workspace-selection'
import type { StoryTimelineBranchNode, TimelineSelection } from '@/lib/story-branch-types'

const branchNodes: StoryTimelineBranchNode[] = [
  {
    type: 'branch_node',
    readableLabel: 'RE-01',
    readableLineageLabel: 'RE-01',
    id: 'rewrite-node-1',
    nodeType: 'rewrite',
    anchorChapterNo: 10,
    parentNodeId: null,
    title: 'RE-01 第一版改写',
    subtitle: '首个保存的改写节点',
    laneIndex: 0,
    colorToken: 'fuchsia',
    sourceChapterNo: 10,
    targetChapterNo: null,
    continueBlockId: 'rewrite-block-1',
    whatIfSessionId: null,
    futureJumpRunId: null,
    currentText: '改写版本正文',
    inputTokens: 111,
    outputTokens: 222,
    status: 'active',
  },
  {
    type: 'branch_node',
    readableLabel: 'IF-01',
    readableLineageLabel: 'IF-01',
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
    currentText: '假设分支正文',
    inputTokens: 333,
    outputTokens: 444,
    status: 'active',
  },
  {
    type: 'branch_node',
    readableLabel: 'CONT-01',
    readableLineageLabel: 'RE-01, CONT-01',
    id: 'continue-node-1',
    nodeType: 'continue_block',
    anchorChapterNo: 10,
    parentNodeId: 'rewrite-node-1',
    title: 'RE-01, CONT-01 续写块',
    subtitle: '沿着分支继续推进',
    laneIndex: 1,
    colorToken: 'fuchsia',
    sourceChapterNo: 10,
    targetChapterNo: null,
    continueBlockId: 'continue-block-1',
    whatIfSessionId: null,
    futureJumpRunId: null,
    currentText: '续写块正文',
    status: 'active',
    inputTokens: null,
    outputTokens: null,
  },
  {
    type: 'branch_node',
    readableLabel: 'JUMP-01',
    readableLineageLabel: 'RE-01, JUMP-01',
    id: 'jump-node-1',
    nodeType: 'future_jump',
    anchorChapterNo: 100,
    parentNodeId: 'rewrite-node-1',
    title: 'RE-01, JUMP-01 第100章',
    subtitle: '跳到未来',
    laneIndex: 1,
    colorToken: 'sky',
    sourceChapterNo: 10,
    targetChapterNo: 100,
    continueBlockId: null,
    whatIfSessionId: null,
    futureJumpRunId: 'jump-run-1',
    currentText: '未来跳转正文',
    inputTokens: 555,
    outputTokens: 666,
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
      roleplayView={<div data-testid="roleplay-slot">roleplay seam</div>}
      branchReadableLabel={selection.kind === 'chapter' ? null : branchNodes.find((node) => node.id === selection.nodeId)?.readableLabel ?? null}
      branchInstructionText={selection.kind === 'chapter' ? null : branchNodes.find((node) => node.id === selection.nodeId)?.subtitle ?? null}
    />
  )

  return { onCenterPaneViewChange }
}

describe('workspace selection shell', () => {
  it('only restores from the backend on mount when the workspace store is not already loaded', () => {
    expect(shouldLoadWorkspaceFromBackendOnMount(false)).toBe(true)
    expect(shouldLoadWorkspaceFromBackendOnMount(true)).toBe(false)
  })

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

  it('uses the current node readable label in workspace branch chrome while keeping lineage metadata available on the node', () => {
    renderPane({
      kind: 'continue_block',
      nodeId: 'continue-node-1',
      continueBlockId: 'continue-block-1',
      anchorChapterNo: 10,
    })

    expect(screen.getByRole('heading', { level: 2, name: 'CONT-01' })).toBeInTheDocument()
    expect(screen.getAllByText('CONT-01')).toHaveLength(2)
    expect(screen.queryByText('RE-01, CONT-01')).not.toBeInTheDocument()
    expect(branchNodes.find((node) => node.id === 'continue-node-1')?.readableLineageLabel).toBe('RE-01, CONT-01')
  })

  it('round-trips chapter, rewrite, what-if, and future-jump selections through URL search params', () => {
    const rewriteSearch = writeWorkspaceSelectionToSearchParams(new URLSearchParams('foo=bar'), {
      kind: 'rewrite',
      nodeId: 'rewrite-node-1',
      continueBlockId: 'rewrite-block-1',
      anchorChapterNo: 10,
    })
    expect(rewriteSearch.get('foo')).toBe('bar')
    expect(rewriteSearch.get('selectionNodeId')).toBe('rewrite-node-1')
    expect(rewriteSearch.get('selectionContinueBlockId')).toBe('rewrite-block-1')
    expect(rewriteSearch.get('selectionReadableLabel')).toBeNull()
    expect(readWorkspaceSelectionFromSearchParams(rewriteSearch)).toEqual({
      kind: 'rewrite',
      nodeId: 'rewrite-node-1',
      continueBlockId: 'rewrite-block-1',
      anchorChapterNo: 10,
    })

    const whatIfSearch = writeWorkspaceSelectionToSearchParams(rewriteSearch, {
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

  it('preserves rewrite selection after saving the first rewrite and only falls back to continue for real child blocks', () => {
    expect(resolveContinueBlockSelectionAfterSave({
      matchingNode: branchNodes[0],
      result: {
        timelineNodeId: 'rewrite-node-1',
        continueBlockId: 'rewrite-block-1',
        nodeType: 'rewrite',
      },
      fallbackAnchorChapterNo: 10,
      parentTimelineNodeId: null,
    })).toEqual({
      kind: 'rewrite',
      nodeId: 'rewrite-node-1',
      continueBlockId: 'rewrite-block-1',
      anchorChapterNo: 10,
    })

    expect(resolveContinueBlockSelectionAfterSave({
      matchingNode: null,
      result: {
        timelineNodeId: 'rewrite-node-fallback',
        continueBlockId: 'rewrite-block-fallback',
        nodeType: 'rewrite',
      },
      fallbackAnchorChapterNo: 10,
      parentTimelineNodeId: null,
    })).toEqual({
      kind: 'rewrite',
      nodeId: 'rewrite-node-fallback',
      continueBlockId: 'rewrite-block-fallback',
      anchorChapterNo: 10,
    })

    expect(resolveContinueBlockSelectionAfterSave({
      matchingNode: null,
      result: {
        timelineNodeId: 'continue-node-fallback',
        continueBlockId: 'continue-block-fallback',
        nodeType: 'continue_block',
      },
      fallbackAnchorChapterNo: 10,
      parentTimelineNodeId: 'rewrite-node-1',
    })).toEqual({
      kind: 'continue_block',
        nodeId: 'continue-node-fallback',
        continueBlockId: 'continue-block-fallback',
        anchorChapterNo: 10,
      })

    expect(resolveContinueBlockSelectionAfterSave({
      matchingNode: null,
      result: {
        timelineNodeId: 'rewrite-node-from-response',
        continueBlockId: 'rewrite-block-from-response',
        nodeType: 'rewrite',
      },
      fallbackAnchorChapterNo: 10,
      parentTimelineNodeId: 'some-parent-node',
    })).toEqual({
      kind: 'rewrite',
      nodeId: 'rewrite-node-from-response',
      continueBlockId: 'rewrite-block-from-response',
      anchorChapterNo: 10,
    })
  })

  it('falls back to the nearest surviving parent or anchor chapter after deleting the selected node', () => {
    expect(resolveSelectionAfterDeletedBranchNode({
      deletedNode: branchNodes[2],
      previousSelection: {
        kind: 'continue_block',
        nodeId: 'continue-node-1',
        continueBlockId: 'continue-block-1',
        anchorChapterNo: 10,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      chapters: [
        { id: 'chapter-10', order: 10 },
        { id: 'chapter-100', order: 100 },
      ],
      branchNodes: [branchNodes[0], branchNodes[1], branchNodes[3]],
    })).toEqual({
      kind: 'rewrite',
      nodeId: 'rewrite-node-1',
      continueBlockId: 'rewrite-block-1',
      anchorChapterNo: 10,
    })

    expect(resolveSelectionAfterDeletedBranchNode({
      deletedNode: branchNodes[0],
      previousSelection: {
        kind: 'rewrite',
        nodeId: 'rewrite-node-1',
        continueBlockId: 'rewrite-block-1',
        anchorChapterNo: 10,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      chapters: [
        { id: 'chapter-10', order: 10 },
        { id: 'chapter-100', order: 100 },
      ],
      branchNodes: [
        { ...branchNodes[2], parentNodeId: null },
        { ...branchNodes[3], parentNodeId: null },
      ],
    })).toEqual({
      kind: 'chapter',
      chapterId: 'chapter-10',
      chapterNo: 10,
    })

    expect(resolveSelectionAfterDeletedBranchNode({
      deletedNode: branchNodes[3],
      previousSelection: {
        kind: 'future_jump',
        nodeId: 'jump-node-1',
        runId: 'jump-run-1',
        sourceChapterNo: 10,
        targetChapterNo: 100,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      chapters: [
        { id: 'chapter-10', order: 10 },
        { id: 'chapter-100', order: 100 },
      ],
      branchNodes: [branchNodes[0], branchNodes[1], branchNodes[2]],
    })).toEqual({
      kind: 'rewrite',
      nodeId: 'rewrite-node-1',
      continueBlockId: 'rewrite-block-1',
      anchorChapterNo: 10,
    })

    expect(resolveSelectionAfterDeletedBranchNode({
      deletedNode: branchNodes[1],
      previousSelection: {
        kind: 'what_if',
        nodeId: 'if-node-1',
        sessionId: 'what-if-session-1',
        anchorChapterNo: 10,
      },
      currentChapter: { id: 'chapter-10', order: 10 },
      chapters: [
        { id: 'chapter-10', order: 10 },
        { id: 'chapter-100', order: 100 },
      ],
      branchNodes: [branchNodes[0], branchNodes[2], branchNodes[3]],
    })).toEqual({
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

    fireEvent.click(screen.getByRole('button', { name: '图谱' }))

    expect(screen.getByTestId('chapter-body-view')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-chapter-view-toggle')).toBeInTheDocument()
    expect(onCenterPaneViewChange).toHaveBeenCalledWith('graph')
  })

  it('switches to what-if and future-jump seams without showing chapter controls', () => {
    const rewrite = renderPane({
      kind: 'rewrite',
      nodeId: 'rewrite-node-1',
      continueBlockId: 'rewrite-block-1',
      anchorChapterNo: 10,
    })

    expect(screen.getByTestId('continue-block-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-chapter-view-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-center-pane-kind')).toHaveTextContent('改写节点工作区')
    expect(rewrite.onCenterPaneViewChange).not.toHaveBeenCalled()
    cleanup()

    const whatIf = renderPane({
      kind: 'what_if',
      nodeId: 'if-node-1',
      sessionId: 'what-if-session-1',
      anchorChapterNo: 10,
    })

    expect(screen.getByTestId('what-if-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-chapter-view-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-center-pane-kind')).toHaveTextContent('What-if 会话工作区')
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
    expect(screen.getAllByText('CONT-01')).toHaveLength(2)
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
    expect(screen.getByTestId('workspace-center-pane-kind')).toHaveTextContent('Future Jump 工作区')
  })

  it('derives current-node metrics from the visible selection text and version-specific usage', () => {
    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'chapter', chapterId: 'chapter-10', chapterNo: 10 },
      chapterText: '章节当前可见正文',
      selectedNode: null,
    })).toEqual({
      wordCount: 8,
      inputTokens: null,
      outputTokens: null,
    })

    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'rewrite', nodeId: 'rewrite-node-1', continueBlockId: 'rewrite-block-1', anchorChapterNo: 10 },
      chapterText: '不会被使用的章节正文',
      selectedNode: branchNodes[0],
    })).toEqual({
      wordCount: 6,
      inputTokens: 111,
      outputTokens: 222,
    })

    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'continue_block', nodeId: 'continue-node-1', continueBlockId: 'continue-block-1', anchorChapterNo: 10 },
      chapterText: '不会被使用的章节正文',
      selectedNode: branchNodes[2],
    })).toEqual({
      wordCount: 5,
      inputTokens: null,
      outputTokens: null,
    })

    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'what_if', nodeId: 'if-node-1', sessionId: 'what-if-session-1', anchorChapterNo: 10 },
      chapterText: '不会被使用的章节正文',
      selectedNode: branchNodes[1],
    })).toEqual({
      wordCount: 6,
      inputTokens: 333,
      outputTokens: 444,
    })

    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'future_jump', nodeId: 'jump-node-1', runId: 'jump-run-1', sourceChapterNo: 10, targetChapterNo: 100 },
      chapterText: '不会被使用的章节正文',
      selectedNode: branchNodes[3],
    })).toEqual({
      wordCount: 6,
      inputTokens: 555,
      outputTokens: 666,
    })

    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'future_jump', nodeId: 'jump-node-1', runId: 'jump-run-1', sourceChapterNo: 10, targetChapterNo: 100 },
      chapterText: '不会被使用的章节正文',
      selectedNode: branchNodes[3],
      override: {
        currentText: '修订后的未来节点正文',
        inputTokens: 888,
        outputTokens: 777,
      },
    })).toEqual({
      wordCount: 10,
      inputTokens: 888,
      outputTokens: 777,
    })

    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'future_jump', nodeId: 'jump-node-1', runId: 'jump-run-1', sourceChapterNo: 10, targetChapterNo: 100 },
      chapterText: '不会被使用的章节正文',
      selectedNode: branchNodes[3],
      override: {
        currentText: '没有 token 的当前版本正文',
        inputTokens: null,
        outputTokens: null,
      },
    })).toEqual({
      wordCount: 14,
      inputTokens: null,
      outputTokens: null,
    })

    expect(resolveCurrentNodeMetrics({
      selection: { kind: 'future_jump', nodeId: 'jump-node-1', runId: 'jump-run-1', sourceChapterNo: 10, targetChapterNo: 100 },
      chapterText: '不会被使用的章节正文',
      selectedNode: branchNodes[3],
      override: undefined,
    })).toEqual({
      wordCount: 6,
      inputTokens: 555,
      outputTokens: 666,
    })
  })

  it('hides advanced-context output constraints while keeping other prompt blocks available', () => {
    expect(getVisibleAdvancedContextPromptBlocks([
      { id: 'story-summary', label: '故事摘要', enabled: true, priority: 'high', content: '# 故事摘要\n- 当前冲突。' },
      { id: 'output-constraints', label: '输出要求', enabled: true, priority: 'high', content: '# 输出要求\n- 只输出正文。' },
      { id: 'preset-compat', label: 'Preset Compat', enabled: true, priority: 'medium', content: '# Preset Compat\n- 保留兼容提示。' },
    ])).toEqual([
      { id: 'story-summary', label: '故事摘要', enabled: true, priority: 'high', content: '# 故事摘要\n- 当前冲突。' },
      { id: 'preset-compat', label: 'Preset Compat', enabled: true, priority: 'medium', content: '# Preset Compat\n- 保留兼容提示。' },
    ])
  })
})
