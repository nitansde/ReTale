// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FutureJumpView } from '@/components/future-jump/FutureJumpView'
import type { FutureJumpRunDetail, FutureMapResponse, WhatIfSessionDetail } from '@/lib/story-branch-types'

const parentSession: WhatIfSessionDetail = {
  id: 'what-if-session-001',
  novelId: 'novel-001',
  baseBranchId: 'novel-001:main',
  sourceChapterNo: 10,
  title: 'IF-01 决裂线',
  premise: '如果他们在这里闹翻。',
  selectedText: '“你根本没信过我。”',
  originalText: '原始章节正文',
  generatedText: 'What-if 正文',
  status: 'active',
  createdAt: '2026-05-15T01:23:45.000Z',
  updatedAt: '2026-05-15T01:23:45.000Z',
  deltas: [],
}

const futureMapPayload: FutureMapResponse = {
  novelId: 'novel-001',
  branchId: 'novel-001:main',
  tracks: [{ trackKey: 'phase-3', phaseLabel: '第三阶段', eventCount: 1, sourceTypes: ['authored'] }],
  events: [
    {
      id: 'outline_event_100',
      chapterNo: 100,
      title: '第100章 被绑走',
      summary: '女主被带走，误会已经失控。',
      originalOutcome: '原线还有较早的援手。',
      trackKey: 'phase-3',
      phaseLabel: '第三阶段',
      sourceType: 'authored',
      confidence: 0.9,
      sortOrder: 1,
    },
  ],
  chaptersByEvent: {
    outline_event_100: [
      {
        id: 'outline_chapter_100_primary',
        outlineNodeId: 'outline_event_100',
        chapterNo: 100,
        chapterId: 'chapter-100',
        chapterTitle: '第100章 被绑走',
        isPrimary: true,
        sortOrder: 0,
        createdAt: '2026-05-15T01:23:45.000Z',
        updatedAt: '2026-05-15T01:23:45.000Z',
      },
    ],
  },
  defaults: {
    selectedTrackKey: 'phase-3',
    selectedOutlineNodeId: 'outline_event_100',
  },
}

function buildRunDetail(latestRevisionNo: number, bridgeSummary: string, generatedTargetText: string): FutureJumpRunDetail {
  return {
    id: 'jump-run-001',
    sessionId: 'what-if-session-001',
    baseBranchId: 'novel-001:main',
    parentTimelineNodeId: 'if-node-1',
    sourceContext: {
      nodeId: 'if-node-1',
      nodeType: 'what_if',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: 'what-if-session-001',
    },
    targetOutlineNodeId: 'outline_event_100',
    targetOutlineChapterId: 'outline_chapter_100_primary',
    sourceChapterNo: 10,
    targetChapterNo: 100,
    userDirection: '让救援更晚到来',
    bridgeSummary,
    generatedTargetText,
    latestRevisionNo,
    errorMessage: null,
    status: latestRevisionNo > 2 ? 'revised' : 'generated',
    createdAt: '2026-05-15T01:23:45.000Z',
    updatedAt: '2026-05-15T01:23:45.000Z',
    timelineNodeId: 'jump-node-1',
    latestRevision: {
      id: `future-jump-revision-${latestRevisionNo}`,
      runId: 'jump-run-001',
      revisionNo: latestRevisionNo,
      revisionKind: latestRevisionNo === 1 ? 'initial' : 'feedback',
      userFeedback: latestRevisionNo === 1 ? null : '让误会多拖一段时间',
      bridgeSummary,
      generatedTargetText,
      createdAt: `2026-05-15T01:2${latestRevisionNo}:45.000Z`,
    },
    revisionHistory: [
      {
        revisionNo: 1,
        revisionKind: 'initial',
        userFeedback: null,
        createdAt: '2026-05-15T01:21:45.000Z',
      },
      {
        revisionNo: 2,
        revisionKind: 'feedback',
        userFeedback: '让误会多拖一段时间',
        createdAt: '2026-05-15T01:22:45.000Z',
      },
      ...(latestRevisionNo > 2
        ? [{
            revisionNo: latestRevisionNo,
            revisionKind: 'feedback',
            userFeedback: '把救援推得更晚',
            createdAt: '2026-05-15T01:23:45.000Z',
          }]
        : []),
    ],
    revisions: [
      {
        id: 'future-jump-revision-1',
        runId: 'jump-run-001',
        revisionNo: 1,
        revisionKind: 'initial',
        userFeedback: null,
        bridgeSummary: '初始桥接摘要',
        generatedTargetText: '初始未来正文',
        createdAt: '2026-05-15T01:21:45.000Z',
      },
      {
        id: 'future-jump-revision-2',
        runId: 'jump-run-001',
        revisionNo: 2,
        revisionKind: 'feedback',
        userFeedback: '让误会多拖一段时间',
        bridgeSummary: '第二版桥接摘要',
        generatedTargetText: '第二版未来正文',
        createdAt: '2026-05-15T01:22:45.000Z',
      },
      ...(latestRevisionNo > 2
        ? [{
            id: `future-jump-revision-${latestRevisionNo}`,
            runId: 'jump-run-001',
            revisionNo: latestRevisionNo,
            revisionKind: 'feedback',
            userFeedback: '把救援推得更晚',
            bridgeSummary,
            generatedTargetText,
            createdAt: '2026-05-15T01:23:45.000Z',
          }]
        : []),
    ],
  }
}

describe('FutureJumpView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders latest mirrored content, sorts history newest-first, and refreshes after revise', async () => {
    let currentDetail = buildRunDetail(2, '最新镜像桥接摘要', '最新镜像未来正文')
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/future-jump/runs/jump-run-001?')) {
        return new Response(JSON.stringify(currentDetail), { status: 200 })
      }
      if (url === '/api/what-if/sessions/what-if-session-001?novelId=novel-001&branchId=novel-001%3Amain') {
        return new Response(JSON.stringify(parentSession), { status: 200 })
      }
      if (url.startsWith('/api/story-future-map?')) {
        return new Response(JSON.stringify(futureMapPayload), { status: 200 })
      }
      if (url === '/api/future-jump/runs/jump-run-001/revise' && init?.method === 'POST') {
        currentDetail = buildRunDetail(3, '第三版镜像桥接摘要', '第三版镜像未来正文')
        return new Response(JSON.stringify({
          runId: 'jump-run-001',
          timelineNodeId: 'jump-node-1',
          bridgeSummary: currentDetail.bridgeSummary,
          generatedTargetText: currentDetail.generatedTargetText,
        }), { status: 200 })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onContinueInFuture = vi.fn()

    render(
      <FutureJumpView
        novelId="novel-001"
        branchId="novel-001:main"
        runId="jump-run-001"
        sourceChapterNo={10}
        targetChapterNo={100}
        nodeTitle="JUMP-01 第100章"
        onContinueInFuture={onContinueInFuture}
      />
    )

    expect(await screen.findByTestId('future-jump-view')).toBeInTheDocument()
    expect(await screen.findByTestId('future-jump-bridge')).toHaveTextContent('最新镜像桥接摘要')
    expect(screen.getByTestId('future-jump-text')).toHaveTextContent('最新镜像未来正文')
    expect(screen.getByTestId('future-jump-feedback')).toBeInTheDocument()
    expect(screen.getByTestId('future-jump-regenerate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue this Future' })).toBeInTheDocument()
    expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('第二版桥接摘要')
    expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('第二版未来正文')
    expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('初始桥接摘要')
    expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('初始未来正文')
    expect(screen.getByTestId('future-jump-revision-history')).not.toHaveTextContent('最新镜像桥接摘要')
    expect(screen.getByTestId('future-jump-revision-history')).not.toHaveTextContent('最新镜像未来正文')

    const revisionLabels = screen.getAllByText(/第 \d+ 版/).map((item) => item.textContent)
    expect(revisionLabels[0]).toContain('第 2 版')

    fireEvent.change(screen.getByTestId('future-jump-feedback'), {
      target: { value: '把救援推得更晚' },
    })
    fireEvent.click(screen.getByTestId('future-jump-regenerate'))

    await waitFor(() => {
      expect(screen.getByTestId('future-jump-bridge')).toHaveTextContent('第三版镜像桥接摘要')
      expect(screen.getByTestId('future-jump-text')).toHaveTextContent('第三版镜像未来正文')
      expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('第二版桥接摘要')
      expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('第二版未来正文')
      expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('初始桥接摘要')
      expect(screen.getByTestId('future-jump-revision-history')).toHaveTextContent('初始未来正文')
      expect(screen.getByTestId('future-jump-revision-history')).not.toHaveTextContent('第三版镜像桥接摘要')
      expect(screen.getByTestId('future-jump-revision-history')).not.toHaveTextContent('第三版镜像未来正文')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue this Future' }))

    expect(onContinueInFuture).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ latestRevisionNo: 3, generatedTargetText: '第三版镜像未来正文' }),
      })
    )
  })

  it('shows an explicit revise error when the latest revision request fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/future-jump/runs/jump-run-001?')) {
        return new Response(JSON.stringify(buildRunDetail(2, '最新镜像桥接摘要', '最新镜像未来正文')), { status: 200 })
      }
      if (url === '/api/what-if/sessions/what-if-session-001?novelId=novel-001&branchId=novel-001%3Amain') {
        return new Response(JSON.stringify(parentSession), { status: 200 })
      }
      if (url.startsWith('/api/story-future-map?')) {
        return new Response(JSON.stringify(futureMapPayload), { status: 200 })
      }
      if (url === '/api/future-jump/runs/jump-run-001/revise' && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: '修订失败' }), { status: 500 })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <FutureJumpView
        novelId="novel-001"
        branchId="novel-001:main"
        runId="jump-run-001"
        sourceChapterNo={10}
        targetChapterNo={100}
        nodeTitle="JUMP-01 第100章"
        onContinueInFuture={() => undefined}
      />
    )

    expect(await screen.findByTestId('future-jump-view')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('future-jump-feedback'), {
      target: { value: '把救援推得更晚' },
    })
    expect(screen.getByRole('button', { name: 'Continue this Future' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('future-jump-regenerate'))

    await waitFor(() => {
      expect(screen.getByTestId('future-jump-action-error')).toHaveTextContent('修订失败')
    })
  })

  it('keeps the persisted run view usable when parent session metadata fails to load', async () => {
    let currentDetail = buildRunDetail(2, '最新镜像桥接摘要', '最新镜像未来正文')
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/future-jump/runs/jump-run-001?')) {
        return new Response(JSON.stringify(currentDetail), { status: 200 })
      }
      if (url === '/api/what-if/sessions/what-if-session-001?novelId=novel-001&branchId=novel-001%3Amain') {
        return new Response(JSON.stringify({ error: 'parent failed' }), { status: 500 })
      }
      if (url.startsWith('/api/story-future-map?')) {
        return new Response(JSON.stringify(futureMapPayload), { status: 200 })
      }
      if (url === '/api/future-jump/runs/jump-run-001/revise' && init?.method === 'POST') {
        currentDetail = buildRunDetail(3, '第三版镜像桥接摘要', '第三版镜像未来正文')
        return new Response(JSON.stringify({
          runId: 'jump-run-001',
          timelineNodeId: 'jump-node-1',
          bridgeSummary: currentDetail.bridgeSummary,
          generatedTargetText: currentDetail.generatedTargetText,
        }), { status: 200 })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <FutureJumpView
        novelId="novel-001"
        branchId="novel-001:main"
        runId="jump-run-001"
        sourceChapterNo={10}
        targetChapterNo={100}
        nodeTitle="JUMP-01 第100章"
        onContinueInFuture={() => undefined}
      />
    )

    expect(await screen.findByTestId('future-jump-view')).toBeInTheDocument()
    expect(screen.getByTestId('future-jump-bridge')).toHaveTextContent('最新镜像桥接摘要')
    expect(screen.getByTestId('future-jump-text')).toHaveTextContent('最新镜像未来正文')
    expect(screen.getByTestId('future-jump-feedback')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue this Future' })).toBeInTheDocument()
    expect(screen.queryByText('parent failed')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('future-jump-feedback'), {
      target: { value: '把救援推得更晚' },
    })
    fireEvent.click(screen.getByTestId('future-jump-regenerate'))

    await waitFor(() => {
      expect(screen.getByTestId('future-jump-bridge')).toHaveTextContent('第三版镜像桥接摘要')
      expect(screen.getByTestId('future-jump-text')).toHaveTextContent('第三版镜像未来正文')
    })
  })
})
