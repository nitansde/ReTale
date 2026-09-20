// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  writingSkillCardIds: [],
  writingSkillExampleCount: 5,
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

  it('switches between saved versions with matching instructions and metrics', async () => {
    const onMetricsChange = vi.fn()
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
        onMetricsChange={onMetricsChange}
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
    expect(screen.getByTestId('continue-block-user-request')).toHaveTextContent('把誓言后的情绪变化压进同一场景。')
    expect(screen.queryByText('第一版续写正文')).not.toBeInTheDocument()
    const selector = screen.getByRole('combobox', { name: '切换版本' })
    expect(selector).toHaveValue('2')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['版本 2（最新）', '版本 1'])

    fireEvent.change(selector, { target: { value: '1' } })
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第一版续写正文')
    expect(screen.queryByText('第二版续写正文')).not.toBeInTheDocument()
    expect(screen.getByTestId('continue-block-user-request')).toHaveTextContent('先写第一版。')
    expect(onMetricsChange).toHaveBeenLastCalledWith({ currentText: '第一版续写正文', inputTokens: 100, outputTokens: 200 })

    fireEvent.change(selector, { target: { value: '2' } })
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第二版续写正文')
    expect(screen.getByTestId('continue-block-user-request')).toHaveTextContent('把誓言后的情绪变化压进同一场景。')
    expect(onMetricsChange).toHaveBeenLastCalledWith({ currentText: '第二版续写正文', inputTokens: 120, outputTokens: 240 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the complete multi-line user request instead of a shortened prompt preview', async () => {
    const fullUserRequest = '保持人物克制，不要立刻解释误会。\n\n让旧徽章触发一段完整回忆，并在结尾留下下一章可接续的动作。'
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ ...continueBlockDetail, userInstruction: fullUserRequest }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ContinueBlockDetailView
        novelId="novel-001"
        branchId="novel-001:main"
        continueBlockId="continue-block-001"
        latestRevisionNo={2}
      />
    )

    const request = await screen.findByTestId('continue-block-user-request')
    expect(request).toHaveTextContent('保持人物克制，不要立刻解释误会。 让旧徽章触发一段完整回忆，并在结尾留下下一章可接续的动作。')
    expect(request).not.toHaveTextContent('…')
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
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第二版续写正文')
    fireEvent.change(screen.getByRole('combobox', { name: '切换版本' }), { target: { value: '1' } })
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第一版续写正文')

    rerender(
      <ContinueBlockDetailView
        novelId="novel-001"
        branchId="novel-001:main"
        continueBlockId="continue-block-001"
        latestRevisionNo={3}
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
    expect(screen.getByRole('combobox', { name: '切换版本' })).toHaveValue('3')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['版本 3（最新）', '版本 2', '版本 1'])
    fireEvent.change(screen.getByRole('combobox', { name: '切换版本' }), { target: { value: '2' } })
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('第二版续写正文')
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
    expect(screen.getByRole('combobox', { name: '切换版本' })).toBeDisabled()

    ;(resolveFetch as ((value: Response) => void) | null)?.({
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
    expect(await screen.findByText('读取续写块详情失败，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '切换版本' })).toBeDisabled()
  })

  it('does not leak the selected version into another node while its detail is loading', async () => {
    let resolveFetch!: (value: Response) => void
    const nextDetail = {
      ...continueBlockDetail,
      id: 'continue-block-002',
      latestRevisionNo: 1,
      latestText: '另一个节点的正文',
      userInstruction: '另一个节点的创作方向',
      revisions: [],
    }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: true, json: async () => continueBlockDetail } as Response)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    const props = {
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      continueBlockId: 'continue-block-001',
      latestRevisionNo: 2,
      anchorChapterNo: 10,
    }
    const { rerender } = render(<ContinueBlockDetailView {...props} />)
    await screen.findByText('第二版续写正文')
    fireEvent.change(screen.getByRole('combobox', { name: '切换版本' }), { target: { value: '1' } })

    rerender(<ContinueBlockDetailView {...props} continueBlockId={nextDetail.id} latestRevisionNo={1} fallbackDetail={nextDetail} />)
    expect(screen.getByTestId('workspace-continue-block-reader-body')).toHaveTextContent('另一个节点的正文')
    expect(screen.queryByText('第一版续写正文')).not.toBeInTheDocument()
    expect(screen.getByTestId('continue-block-user-request')).toHaveTextContent('另一个节点的创作方向')
    expect(screen.getByRole('combobox', { name: '切换版本' })).toHaveValue('1')
    expect(screen.getByRole('combobox', { name: '切换版本' })).toBeDisabled()

    resolveFetch({ ok: true, json: async () => nextDetail } as Response)
    await waitFor(() => expect(screen.queryByText('正在读取续写块详情…')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: '切换版本' })).toBeEnabled()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: '版本 1（最新）' })).toBeInTheDocument()
  })
})
