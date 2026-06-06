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
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '生成失败' }), { status: 500 }))
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
      expect(screen.getByTestId('future-map-create-error')).toHaveTextContent('生成失败')
    })
  })
})
