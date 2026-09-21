// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FutureMapOverlay } from '@/components/what-if/FutureMapOverlay'
import { FUTURE_MAP_MISSING_SUMMARY_FALLBACK } from '@/lib/story-branch-types'

const futureMapPayload = {
  novelId: 'novel-001',
  branchId: 'novel-001:main',
  tracks: [
    { trackKey: 'phase-3', phaseLabel: '第三阶段', eventCount: 1, sourceTypes: ['authored'] },
    { trackKey: 'phase-4', phaseLabel: '第四阶段', eventCount: 1, sourceTypes: ['derived_event'] },
  ],
  events: [
    {
      id: 'outline_event_100',
      chapterNo: 100,
      title: '第100章 被绑走',
      summary: '女主被带走。',
      originalOutcome: '仍有救援机会。',
      trackKey: 'phase-3',
      phaseLabel: '第三阶段',
      sourceType: 'authored',
      confidence: 1,
      sortOrder: 1,
    },
    {
      id: 'outline_event_120',
      chapterNo: 120,
      title: '第120章 断桥重逢',
      summary: '基于现有线索推导出的重逢节点。',
      originalOutcome: null,
      trackKey: 'phase-4',
      phaseLabel: '第四阶段',
      sourceType: 'derived_event',
      confidence: 0.74,
      sortOrder: 2,
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
    outline_event_120: [
      {
        id: 'outline_chapter_120_primary',
        outlineNodeId: 'outline_event_120',
        chapterNo: 120,
        chapterId: 'chapter-120',
        chapterTitle: '第120章 断桥重逢',
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FutureMapOverlay', () => {
  it('uses the shared named modal and keeps the three panels single-column until lg', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(futureMapPayload), { status: 200 })
    ))

    render(
      <FutureMapOverlay
        novelId="novel-001"
        branchId="novel-001:main"
        sourceContext={{
          nodeId: 'what-if-node-001',
          nodeType: 'what_if',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: 'what-if-session-001',
        }}
        title="IF-01 决裂线"
        parentTimelineNodeId="what-if-node-001"
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    )

    const dialog = screen.getByRole('dialog', { name: '跳到未来' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('max-w-[1680px]', 'w-[calc(100%-2rem)]')
    expect(document.body.style.overflow).toBe('hidden')

    const layout = await screen.findByTestId('future-map-layout')
    expect(layout).toHaveClass('lg:grid-cols-[248px_minmax(0,1.3fr)_360px]', 'min-w-0')
    expect(layout).not.toHaveClass('sm:grid-cols-[248px_minmax(0,1.3fr)_360px]')
    expect(screen.getByTestId('future-map-tracks')).toHaveClass('min-w-0')
    expect(screen.getByTestId('future-map-candidates')).toHaveClass('min-w-0')
    expect(screen.getByTestId('future-map-confirmation')).toHaveClass('min-w-0')
    expect(screen.getByTestId('future-map-mode-history-node')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('future-map-track-phase-3')).toHaveAttribute('aria-pressed', 'true')
  })

  it('closes by Escape, backdrop, and its named close control while restoring focus', async () => {
    const onClose = vi.fn()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(futureMapPayload), { status: 200 })
    ))

    function Harness() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open Future Map</button>
          {open ? (
            <FutureMapOverlay
              novelId="novel-001"
              branchId="novel-001:main"
              sourceContext={{
                nodeId: 'what-if-node-001',
                nodeType: 'what_if',
                chapterId: 'chapter-25',
                chapterNo: 25,
                whatIfSessionId: 'what-if-session-001',
              }}
              title="IF-01 决裂线"
              parentTimelineNodeId="what-if-node-001"
              onClose={() => {
                onClose()
                setOpen(false)
              }}
              onCreated={() => undefined}
            />
          ) : null}
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open Future Map' })

    opener.focus()
    fireEvent.click(opener)
    expect(await screen.findByRole('dialog', { name: '跳到未来' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()

    opener.focus()
    fireEvent.click(opener)
    const backdropDialog = await screen.findByRole('dialog', { name: '跳到未来' })
    const backdrop = backdropDialog.parentElement!
    fireEvent.mouseDown(backdrop)
    expect(backdropDialog).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseUp(backdrop)
    expect(backdropDialog).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(opener).toHaveFocus()

    opener.focus()
    fireEvent.click(opener)
    await screen.findByRole('dialog', { name: '跳到未来' })
    fireEvent.click(screen.getByRole('button', { name: '关闭跳到未来' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })
  it('locks every dismissal path and keeps creation single-flight until completion', async () => {
    let resolveCreate: (response: Response) => void = () => undefined
    const deferredCreate = new Promise<Response>((resolve) => {
      resolveCreate = resolve
    })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(futureMapPayload), { status: 200 }))
      .mockReturnValueOnce(deferredCreate)
    vi.stubGlobal('fetch', fetchMock)

    const onClose = vi.fn()
    const onCreated = vi.fn().mockResolvedValue(undefined)

    render(
      <FutureMapOverlay
        novelId="novel-001"
        branchId="novel-001:main"
        sourceContext={{
          nodeId: 'what-if-node-001',
          nodeType: 'what_if',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: 'what-if-session-001',
        }}
        title="IF-01 决裂线"
        parentTimelineNodeId="what-if-node-001"
        onClose={onClose}
        onCreated={onCreated}
      />
    )

    expect(await screen.findByTestId('future-map-event-outline_event_100')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('future-map-event-outline_event_100'))

    const confirmButton = screen.getByTestId('future-map-confirm')
    fireEvent.click(confirmButton)

    const dialog = screen.getByRole('dialog', { name: '跳到未来' })
    const closeButton = screen.getByRole('button', { name: '关闭跳到未来' })
    await waitFor(() => {
      expect(dialog).toHaveAttribute('aria-busy', 'true')
      expect(closeButton).toBeDisabled()
      expect(confirmButton).toBeDisabled()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(confirmButton)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(dialog.parentElement!)
    fireEvent.mouseUp(dialog.parentElement!)
    fireEvent.click(dialog.parentElement!)
    fireEvent.click(closeButton)

    expect(onClose).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveCreate(new Response(JSON.stringify({
      runId: 'jump-run-deferred',
      timelineNodeId: 'timeline-node-jump-deferred',
      bridgeSummary: 'bridge',
      generatedTargetText: 'text',
    }), { status: 200 }))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'jump-run-deferred' }),
        { sourceChapterNo: 25, targetChapterNo: 100 }
      )
      expect(dialog).not.toHaveAttribute('aria-busy')
      expect(closeButton).not.toBeDisabled()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('history-node mode resolves the chapter immediately and posts the unified create payload', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(futureMapPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        runId: 'jump-run-002',
        timelineNodeId: 'timeline-node-jump-002',
        bridgeSummary: 'bridge',
        generatedTargetText: 'text',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const onCreated = vi.fn()

    render(
      <FutureMapOverlay
        novelId="novel-001"
        branchId="novel-001:main"
        sourceContext={{
          nodeId: 'continue-node-025',
          nodeType: 'continue_block',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: 'what-if-session-001',
        }}
        title="IF-01 决裂线"
        parentTimelineNodeId="if-node-1"
        onClose={() => undefined}
        onCreated={onCreated}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('future-map-track-phase-3')).toBeInTheDocument()
    })

    const confirmButton = screen.getByTestId('future-map-confirm')
    expect(confirmButton).toBeDisabled()
    expect(screen.getByTestId('future-map-mode-history-node')).toBeInTheDocument()
    expect(screen.getByTestId('future-map-mode-direct-chapter')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('future-map-track-phase-4'))
    expect(screen.getByTestId('future-map-event-outline_event_120')).toBeInTheDocument()
    expect(screen.queryByTestId('future-map-event-outline_event_100')).not.toBeInTheDocument()
    expect(screen.getByText('derived event')).toBeInTheDocument()
    expect(screen.getByText(/置信度 74%/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('future-map-track-phase-3'))
    fireEvent.click(screen.getByTestId('future-map-event-outline_event_100'))
    expect(confirmButton).not.toBeDisabled()
    expect(screen.getByTestId('future-map-resolved-chapter')).toHaveTextContent('第 100 章')
    expect(screen.getByTestId('future-map-resolved-chapter')).toHaveTextContent('第100章 被绑走')

    fireEvent.change(screen.getByPlaceholderText(/可选：给这次 Future Jump 一句额外方向/), {
      target: { value: '让救援更晚到来' },
    })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'jump-run-002', timelineNodeId: 'timeline-node-jump-002' }),
        { sourceChapterNo: 25, targetChapterNo: 100 }
      )
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/future-jump/runs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1] && (fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(requestBody).toEqual({
      novelId: 'novel-001',
      sourceContext: {
        nodeId: 'continue-node-025',
        nodeType: 'continue_block',
        chapterId: 'chapter-25',
        chapterNo: 25,
        whatIfSessionId: 'what-if-session-001',
      },
      targetOutlineNodeId: 'outline_event_100',
      targetOutlineChapterId: 'outline_chapter_100_primary',
      parentTimelineNodeId: 'if-node-1',
      userDirection: '让救援更晚到来',
    })
  })

  it('direct-chapter mode lists chapter summaries and confirms after one direct chapter selection', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(futureMapPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        runId: 'jump-run-003',
        timelineNodeId: 'timeline-node-jump-003',
        bridgeSummary: 'bridge',
        generatedTargetText: 'text',
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const onCreated = vi.fn()

    render(
      <FutureMapOverlay
        novelId="novel-001"
        branchId="novel-001:main"
        sourceContext={{
          nodeId: 'rewrite-node-001',
          nodeType: 'rewrite',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: null,
        }}
        title="RE-01 改写节点"
        parentTimelineNodeId="rewrite-node-001"
        onClose={() => undefined}
        onCreated={onCreated}
      />
    )

    expect(await screen.findByTestId('future-map-track-phase-3')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('future-map-mode-direct-chapter'))
    expect(screen.getByText('女主被带走。')).toBeInTheDocument()

    const confirmButton = screen.getByTestId('future-map-confirm')
    expect(confirmButton).toBeDisabled()

    fireEvent.click(screen.getByTestId('future-map-direct-chapter-100'))
    expect(confirmButton).not.toBeDisabled()
    expect(screen.getByTestId('future-map-resolved-chapter')).toHaveTextContent('第 100 章')
    expect(screen.getByTestId('future-map-resolved-chapter')).toHaveTextContent('第100章 被绑走')

    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'jump-run-003', timelineNodeId: 'timeline-node-jump-003' }),
        { sourceChapterNo: 25, targetChapterNo: 100 }
      )
    })

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1] && (fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(requestBody).toEqual({
      novelId: 'novel-001',
      sourceContext: {
        nodeId: 'rewrite-node-001',
        nodeType: 'rewrite',
        chapterId: 'chapter-25',
        chapterNo: 25,
        whatIfSessionId: null,
      },
      targetOutlineNodeId: 'outline_event_100',
      targetOutlineChapterId: 'outline_chapter_100_primary',
      parentTimelineNodeId: 'rewrite-node-001',
    })
  })

  it('direct-chapter mode still shows selectable chapter cards when summaries are blank', async () => {
    const payloadWithBlankSummary = {
      ...futureMapPayload,
      events: futureMapPayload.events.map((event) => event.id === 'outline_event_100'
        ? { ...event, summary: '' }
        : event),
    }

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payloadWithBlankSummary), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <FutureMapOverlay
        novelId="novel-001"
        branchId="novel-001:main"
        sourceContext={{
          nodeId: 'rewrite-node-001',
          nodeType: 'rewrite',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: null,
        }}
        title="RE-01 改写节点"
        parentTimelineNodeId="rewrite-node-001"
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    )

    expect(await screen.findByTestId('future-map-track-phase-3')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('future-map-mode-direct-chapter'))

    const confirmButton = screen.getByTestId('future-map-confirm')
    expect(confirmButton).toBeDisabled()
    expect(screen.getByText(FUTURE_MAP_MISSING_SUMMARY_FALLBACK)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('future-map-direct-chapter-100'))
    expect(confirmButton).not.toBeDisabled()
    expect(screen.getByTestId('future-map-resolved-chapter')).toHaveTextContent('第 100 章')
    expect(screen.getByTestId('future-map-resolved-chapter')).toHaveTextContent('第100章 被绑走')
  })

  it('shows an explicit create error when future jump generation fails', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(futureMapPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'HTTP 400: context_length_exceeded, requested 235000 tokens' }), { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <FutureMapOverlay
        novelId="novel-001"
        branchId="novel-001:main"
        sourceContext={{
          nodeId: 'continue-node-025',
          nodeType: 'continue_block',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: 'what-if-session-001',
        }}
        title="IF-01 决裂线"
        parentTimelineNodeId="if-node-1"
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    )

    expect(await screen.findByTestId('future-map-track-phase-3')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('future-map-event-outline_event_100'))
    fireEvent.click(screen.getByTestId('future-map-confirm'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBe(screen.getByTestId('future-map-create-error'))
      expect(screen.getByTestId('future-map-create-error')).toHaveTextContent('创建 Future Jump 失败，请稍后重试。')
      expect(screen.getByTestId('future-map-create-error')).toHaveTextContent('HTTP 400: context_length_exceeded, requested 235000 tokens')
      expect(screen.getByTestId('future-map-create-error')).toHaveTextContent('高级上下文')
    })
  })

  it('replaces raw Future Map load diagnostics with the localized operation fallback', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'SQLITE_BUSY: database is locked' }), { status: 500 })
    ))

    render(
      <FutureMapOverlay
        novelId="novel-001"
        branchId="novel-001:main"
        sourceContext={{
          nodeId: 'continue-node-025',
          nodeType: 'continue_block',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: null,
        }}
        title="CONT-01"
        parentTimelineNodeId="continue-node-025"
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('读取 Future Map 候选失败，请稍后重试。')
    expect(screen.queryByText(/SQLITE_BUSY|database is locked/)).not.toBeInTheDocument()
  })
})
