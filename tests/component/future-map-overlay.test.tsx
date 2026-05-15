// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FutureMapOverlay } from '@/components/what-if/FutureMapOverlay'

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
  it('enforces track -> event -> chapter selection before confirm and posts the create payload', async () => {
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
        sessionId="what-if-session-001"
        sourceChapterNo={10}
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
    expect(screen.queryByTestId('future-map-chapter-100')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('future-map-track-phase-4'))
    expect(screen.getByTestId('future-map-event-outline_event_120')).toBeInTheDocument()
    expect(screen.queryByTestId('future-map-event-outline_event_100')).not.toBeInTheDocument()
    expect(screen.getByText('derived event')).toBeInTheDocument()
    expect(screen.getByText(/置信度 74%/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('future-map-track-phase-3'))
    fireEvent.click(screen.getByTestId('future-map-event-outline_event_100'))
    expect(screen.getByTestId('future-map-chapter-100')).toBeInTheDocument()
    expect(confirmButton).toBeDisabled()

    fireEvent.click(screen.getByTestId('future-map-chapter-100'))
    expect(confirmButton).not.toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText(/可选：给这次 Future Jump 一句额外方向/), {
      target: { value: '让救援更晚到来' },
    })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'jump-run-002', timelineNodeId: 'timeline-node-jump-002' }),
        { sourceChapterNo: 10, targetChapterNo: 100 }
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
      sessionId: 'what-if-session-001',
      targetOutlineNodeId: 'outline_event_100',
      targetOutlineChapterId: 'outline_chapter_100_primary',
      parentTimelineNodeId: 'if-node-1',
      userDirection: '让救援更晚到来',
    })
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
        sessionId="what-if-session-001"
        sourceChapterNo={10}
        title="IF-01 决裂线"
        parentTimelineNodeId="if-node-1"
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    )

    expect(await screen.findByTestId('future-map-track-phase-3')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('future-map-event-outline_event_100'))
    fireEvent.click(screen.getByTestId('future-map-chapter-100'))
    fireEvent.click(screen.getByTestId('future-map-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('future-map-create-error')).toHaveTextContent('生成失败')
    })
  })
})
