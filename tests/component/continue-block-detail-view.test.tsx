// @vitest-environment jsdom

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContinueBlockDetailView } from '@/components/workspace/ContinueBlockDetailView'
import type { ContinueBlockDetail } from '@/lib/story-branch-types'

const continueBlockDetail: ContinueBlockDetail = {
  id: 'continue-block-001',
  novelId: 'novel-001',
  branchId: 'novel-001:main',
  parentTimelineNodeId: null,
  sourceChapterNo: 10,
  title: 'RE-01 誓言后的回声',
  subtitle: '把誓言后的情绪变化压进同一场景。',
  userInstruction: '把誓言后的情绪变化压进同一场景。',
  selectedText: '她握紧那枚旧徽章。',
  originalText: '原始正文',
  latestText: '第二版续写正文',
  inputTokens: 120,
  outputTokens: 240,
  latestRevisionNo: 2,
  status: 'revised',
  createdAt: '2026-05-15T01:23:45.000Z',
  updatedAt: '2026-05-15T01:24:45.000Z',
  timelineNodeId: 'timeline-node-001',
  latestRevision: {
    id: 'continue-block-revision-002',
    continueBlockId: 'continue-block-001',
    revisionNo: 2,
    revisionKind: 'regenerate',
    userInstruction: '把誓言后的情绪变化压进同一场景。',
    selectedText: '她握紧那枚旧徽章。',
    originalText: '原始正文',
    generatedText: '第二版续写正文',
    inputTokens: 120,
    outputTokens: 240,
    title: 'RE-01 誓言后的回声',
    subtitle: '把誓言后的情绪变化压进同一场景。',
    createdAt: '2026-05-15T01:24:45.000Z',
  },
  revisionHistory: [
    { revisionNo: 1, revisionKind: 'initial', createdAt: '2026-05-15T01:23:45.000Z' },
    { revisionNo: 2, revisionKind: 'regenerate', createdAt: '2026-05-15T01:24:45.000Z' },
  ],
  revisions: [
    {
      id: 'continue-block-revision-001',
      continueBlockId: 'continue-block-001',
      revisionNo: 1,
      revisionKind: 'initial',
      userInstruction: '先写第一版。',
      selectedText: '她握紧那枚旧徽章。',
      originalText: '原始正文',
      generatedText: '第一版续写正文',
      inputTokens: 100,
      outputTokens: 200,
      title: 'RE-01 誓言后的回声',
      subtitle: '把誓言后的情绪变化压进同一场景。',
      createdAt: '2026-05-15T01:23:45.000Z',
    },
    {
      id: 'continue-block-revision-002',
      continueBlockId: 'continue-block-001',
      revisionNo: 2,
      revisionKind: 'regenerate',
      userInstruction: '把誓言后的情绪变化压进同一场景。',
      selectedText: '她握紧那枚旧徽章。',
      originalText: '原始正文',
      generatedText: '第二版续写正文',
      inputTokens: 120,
      outputTokens: 240,
      title: 'RE-01 誓言后的回声',
      subtitle: '把誓言后的情绪变化压进同一场景。',
      createdAt: '2026-05-15T01:24:45.000Z',
    },
  ],
}

const regeneratedContinueBlockDetail: ContinueBlockDetail = {
  ...continueBlockDetail,
  latestText: '第三版续写正文',
  inputTokens: 140,
  outputTokens: 260,
  latestRevisionNo: 3,
  updatedAt: '2026-05-15T01:25:45.000Z',
  latestRevision: {
    id: 'continue-block-revision-003',
    continueBlockId: 'continue-block-001',
    revisionNo: 3,
    revisionKind: 'regenerate',
    userInstruction: '把誓言后的情绪变化压进同一场景，并继续加深余波。',
    selectedText: '她握紧那枚旧徽章。',
    originalText: '原始正文',
    generatedText: '第三版续写正文',
    inputTokens: 140,
    outputTokens: 260,
    title: 'RE-01 誓言后的回声',
    subtitle: '把誓言后的情绪变化压进同一场景。',
    createdAt: '2026-05-15T01:25:45.000Z',
  },
  revisionHistory: [
    { revisionNo: 1, revisionKind: 'initial', createdAt: '2026-05-15T01:23:45.000Z' },
    { revisionNo: 2, revisionKind: 'regenerate', createdAt: '2026-05-15T01:24:45.000Z' },
    { revisionNo: 3, revisionKind: 'regenerate', createdAt: '2026-05-15T01:25:45.000Z' },
  ],
  revisions: [
    ...continueBlockDetail.revisions,
    {
      id: 'continue-block-revision-003',
      continueBlockId: 'continue-block-001',
      revisionNo: 3,
      revisionKind: 'regenerate',
      userInstruction: '把誓言后的情绪变化压进同一场景，并继续加深余波。',
      selectedText: '她握紧那枚旧徽章。',
      originalText: '原始正文',
      generatedText: '第三版续写正文',
      inputTokens: 140,
      outputTokens: 260,
      title: 'RE-01 誓言后的回声',
      subtitle: '把誓言后的情绪变化压进同一场景。',
      createdAt: '2026-05-15T01:25:45.000Z',
    },
  ],
}

describe('ContinueBlockDetailView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads persisted detail and keeps older revisions visible after regenerate', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => continueBlockDetail,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ContinueBlockDetailView
        novelId="novel-001"
        branchId="novel-001:main"
        continueBlockId="continue-block-001"
        latestRevisionNo={2}
        anchorChapterNo={10}
        readableLineageLabel="RE-01"
      />
    )

    expect(await screen.findByTestId('workspace-continue-block-view')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/continue-blocks/continue-block-001?novelId=novel-001&branchId=novel-001%3Amain',
        { cache: 'no-store' }
      )
    })

    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第二版续写正文')
    expect(screen.getByTestId('continue-block-revision-history')).toHaveTextContent('第一版续写正文')
    expect(screen.getByTestId('continue-block-history-item-1')).toHaveTextContent('第 1 版 · initial')
  })

  it('refetches persisted detail when latestRevisionNo changes for the same continueBlockId', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => continueBlockDetail,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => regeneratedContinueBlockDetail,
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(
      <ContinueBlockDetailView
        novelId="novel-001"
        branchId="novel-001:main"
        continueBlockId="continue-block-001"
        latestRevisionNo={2}
        anchorChapterNo={10}
        readableLineageLabel="RE-01"
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第二版续写正文')
    expect(screen.getByTestId('continue-block-revision-history')).toHaveTextContent('第一版续写正文')

    rerender(
      <ContinueBlockDetailView
        novelId="novel-001"
        branchId="novel-001:main"
        continueBlockId="continue-block-001"
        latestRevisionNo={3}
        anchorChapterNo={10}
        readableLineageLabel="RE-01"
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/continue-blocks/continue-block-001?novelId=novel-001&branchId=novel-001%3Amain',
      { cache: 'no-store' }
    )
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第三版续写正文')
    expect(screen.getByText('revision 3')).toBeInTheDocument()
    expect(screen.getByTestId('continue-block-revision-history')).toHaveTextContent('第二版续写正文')
    expect(screen.getByTestId('continue-block-revision-history')).toHaveTextContent('第一版续写正文')
  })

  it('renders fallback reader body immediately before persisted detail finishes loading', async () => {
    let resolveFetch: ((value: Response) => void) | null = null
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ContinueBlockDetailView
        novelId="novel-001"
        branchId="novel-001:main"
        continueBlockId="continue-block-001"
        latestRevisionNo={2}
        anchorChapterNo={10}
        fallbackDetail={{
          latestText: '时间线回退正文',
          latestRevisionNo: 2,
          title: 'RE-01 誓言后的回声',
          subtitle: '把誓言后的情绪变化压进同一场景。',
          userInstruction: '把誓言后的情绪变化压进同一场景。',
          inputTokens: 120,
          outputTokens: 240,
        }}
      />
    )

    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('时间线回退正文')
    expect(screen.getByText('正在读取续写块详情…')).toBeInTheDocument()

    resolveFetch?.({
      ok: true,
      json: async () => continueBlockDetail,
    } as Response)

    await waitFor(() => {
      expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第二版续写正文')
    })
  })

  it('keeps fallback reader body visible when persisted detail load fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Continue block load failed' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ContinueBlockDetailView
        novelId="novel-001"
        branchId="novel-001:main"
        continueBlockId="continue-block-001"
        latestRevisionNo={2}
        anchorChapterNo={10}
        fallbackDetail={{
          latestText: '时间线回退正文',
          latestRevisionNo: 2,
          title: 'RE-01 誓言后的回声',
          subtitle: '把誓言后的情绪变化压进同一场景。',
          userInstruction: '把誓言后的情绪变化压进同一场景。',
          inputTokens: 120,
          outputTokens: 240,
        }}
      />
    )

    expect(await screen.findByTestId('workspace-continue-block-reader-body')).toHaveTextContent('时间线回退正文')
    expect(await screen.findByText('Continue block load failed')).toBeInTheDocument()
  })
})
