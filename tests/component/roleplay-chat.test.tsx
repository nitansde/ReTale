// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoleplaySessionView } from '@/components/workspace/RoleplaySessionView'

function buildMessage(input: {
  id: string
  messageIndex: number
  role: 'user' | 'assistant'
  content: string
  parentMessageId?: string | null
  forkedFromMessageId?: string | null
  turnIndex?: number
  variantIndex?: number
}) {
  const turnIndex = input.turnIndex ?? input.messageIndex
  const variantIndex = input.variantIndex ?? 1

  return {
    id: input.id,
    sessionId: 'roleplay-session-001',
    messageIndex: input.messageIndex,
    turnIndex,
    variantIndex,
    variantGroupId: `variant-group-${turnIndex}`,
    role: input.role,
    content: input.content,
    parentMessageId: input.parentMessageId ?? null,
    forkedFromMessageId: input.forkedFromMessageId ?? null,
    createdAt: `2026-05-20T12:0${input.messageIndex}:00.000Z`,
    updatedAt: `2026-05-20T12:0${input.messageIndex}:00.000Z`,
    variantMetadata: {
      turnIndex,
      variantIndex,
      variantGroupId: `variant-group-${turnIndex}`,
    },
    forkMetadata: {
      parentMessageId: input.parentMessageId ?? null,
      forkedFromMessageId: input.forkedFromMessageId ?? null,
    },
  }
}

function buildSessionDetail(messages: ReturnType<typeof buildMessage>[]) {
  return {
    id: 'roleplay-session-001',
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    title: 'RP · 第10章 结盟',
    subtitle: '围绕片段展开角色扮演',
    sourceChapterNo: 10,
    createdAt: '2026-05-20T12:00:00.000Z',
    updatedAt: '2026-05-20T12:00:00.000Z',
    status: 'active',
    sourceSnapshot: {
      chapterId: 'chapter-10',
      chapterNo: 10,
      chapterTitle: '第10章 结盟',
      timelineNodeId: null,
      timelineNodeType: 'chapter',
      selectedText: '“你昨晚为什么没有按约定现身？”',
      textSnapshot: '第10章正文：夜色压下来之前，他们已经开始互相试探。',
      selectedLineStart: 1,
      selectedLineEnd: 2,
    },
    messages,
  }
}

function createStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

describe('RoleplaySessionView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders persisted messages, exposes regenerate state, and lets earlier messages become fork anchors', async () => {
    const detail = buildSessionDetail([
      buildMessage({ id: 'message-1', messageIndex: 1, role: 'user', content: '你昨晚为什么没有按约定现身？' }),
      buildMessage({ id: 'message-2', messageIndex: 2, role: 'assistant', content: '我到了，只是先确认街角没有埋伏。', parentMessageId: 'message-1', turnIndex: 1 }),
    ])

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(detail), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <RoleplaySessionView
        novelId="novel-001"
        branchId="novel-001:main"
        sessionId="roleplay-session-001"
        anchorChapterNo={10}
      />
    )

    expect(await screen.findByTestId('roleplay-chat-core')).toBeInTheDocument()
    expect(screen.getByTestId('roleplay-message-0')).toHaveTextContent('你昨晚为什么没有按约定现身？')
    expect(screen.getByTestId('roleplay-message-1')).toHaveTextContent('我到了，只是先确认街角没有埋伏。')
    expect(screen.getByTestId('roleplay-composer-send')).toBeDisabled()
    expect(screen.getByTestId('roleplay-regenerate-last')).toBeEnabled()
    expect(screen.getByTestId('roleplay-fork-anchor')).toHaveTextContent('下轮默认接在最新消息后')

    fireEvent.click(screen.getByTestId('roleplay-message-0'))

    expect(screen.getByTestId('roleplay-fork-anchor')).toHaveTextContent('下轮从 #1 分叉')
    expect(screen.getByTestId('roleplay-fork-point-visual-state')).toHaveTextContent('下轮从 #1 分叉')
    expect(screen.getByTestId('roleplay-fork-point-visual-state')).toHaveTextContent('你昨晚为什么没有按约定现身？')
  })

  it('disables regenerate when the latest persisted message is not an assistant reply', async () => {
    const detail = buildSessionDetail([
      buildMessage({ id: 'message-1', messageIndex: 1, role: 'user', content: '只剩一条用户消息。' }),
    ])

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(detail), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <RoleplaySessionView
        novelId="novel-001"
        branchId="novel-001:main"
        sessionId="roleplay-session-001"
        anchorChapterNo={10}
      />
    )

    expect(await screen.findByTestId('roleplay-chat-core')).toBeInTheDocument()
    expect(screen.getByTestId('roleplay-regenerate-last')).toBeDisabled()
  })

  it('sanitizes raw session-load diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'SENTINEL roleplay load SQL stack' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    ))

    render(
      <RoleplaySessionView
        novelId="novel-001"
        branchId="novel-001:main"
        sessionId="roleplay-session-001"
        anchorChapterNo={10}
      />
    )

    expect(await screen.findByText('读取角色扮演会话失败，请稍后重试。')).toBeInTheDocument()
    expect(screen.queryByText(/SENTINEL/)).not.toBeInTheDocument()
  })

  it('does not render a non-JSON streaming response body', async () => {
    const detail = buildSessionDetail([
      buildMessage({ id: 'message-1', messageIndex: 1, role: 'user', content: '你昨晚为什么没有按约定现身？' }),
      buildMessage({ id: 'message-2', messageIndex: 2, role: 'assistant', content: '我到了。', parentMessageId: 'message-1', turnIndex: 1 }),
    ])

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/api/roleplay/sessions/roleplay-session-001?novelId=novel-001&branchId=novel-001%3Amain') {
        return new Response(JSON.stringify(detail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/roleplay/sessions/roleplay-session-001/messages' && init?.method === 'POST') {
        return new Response(JSON.stringify(buildMessage({
          id: 'message-3',
          messageIndex: 3,
          role: 'user',
          content: '继续说。',
          parentMessageId: 'message-2',
          turnIndex: 2,
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/rewrite' && init?.method === 'POST') {
        return new Response('<html>SENTINEL upstream path and stack</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <RoleplaySessionView
        novelId="novel-001"
        branchId="novel-001:main"
        sessionId="roleplay-session-001"
        anchorChapterNo={10}
      />
    )

    expect(await screen.findByTestId('roleplay-chat-core')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('输入角色台词、动作，或你希望推动的剧情。⌘/Ctrl + Enter 发送'), {
      target: { value: '继续说。' },
    })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))

    expect(await screen.findByText('角色扮演生成请求失败，请稍后重试。')).toBeInTheDocument()
    expect(screen.queryByText(/SENTINEL/)).not.toBeInTheDocument()
  })

  it('sends through roleplay session endpoints and keeps rewrite payload chat-only', async () => {
    const initialMessages = [
      buildMessage({ id: 'message-1', messageIndex: 1, role: 'user', content: '你昨晚为什么没有按约定现身？' }),
      buildMessage({ id: 'message-2', messageIndex: 2, role: 'assistant', content: '我到了，只是先确认街角没有埋伏。', parentMessageId: 'message-1', turnIndex: 1 }),
    ]
    let currentDetail = buildSessionDetail(initialMessages)
    const rewritePayloads: Record<string, unknown>[] = []

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/api/roleplay/sessions/roleplay-session-001?novelId=novel-001&branchId=novel-001%3Amain') {
        return new Response(JSON.stringify(currentDetail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url === '/api/roleplay/sessions/roleplay-session-001/messages' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          novelId: string
          branchId: string
          role: 'user' | 'assistant'
          content: string
          parentMessageId?: string | null
          forkedFromMessageId?: string | null
        }

        expect(body.novelId).toBe('novel-001')
        expect(body.branchId).toBe('novel-001:main')

        if (body.role === 'user') {
          const userMessage = buildMessage({
            id: 'message-3',
            messageIndex: 3,
            role: 'user',
            content: body.content,
            parentMessageId: body.parentMessageId,
            forkedFromMessageId: body.forkedFromMessageId,
            turnIndex: 2,
          })
          currentDetail = {
            ...currentDetail,
            messages: [...currentDetail.messages, userMessage],
          }
          return new Response(JSON.stringify(userMessage), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const assistantMessage = buildMessage({
          id: 'message-4',
          messageIndex: 4,
          role: 'assistant',
          content: body.content,
          parentMessageId: body.parentMessageId,
          forkedFromMessageId: body.forkedFromMessageId,
          turnIndex: 2,
        })
        currentDetail = {
          ...currentDetail,
          messages: [...currentDetail.messages, assistantMessage],
        }
        return new Response(JSON.stringify(assistantMessage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url === '/api/rewrite' && init?.method === 'POST') {
        rewritePayloads.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return createStreamResponse(['她没有立刻反驳，', '只是把质问压低成一声叹息。'])
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <RoleplaySessionView
        novelId="novel-001"
        branchId="novel-001:main"
        sessionId="roleplay-session-001"
        anchorChapterNo={10}
      />
    )

    expect(await screen.findByTestId('roleplay-chat-core')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('输入角色台词、动作，或你希望推动的剧情。⌘/Ctrl + Enter 发送'), {
      target: { value: '别再躲了，给我一个真正的解释。' },
    })
    expect(screen.getByTestId('roleplay-composer-send')).toBeEnabled()

    fireEvent.click(screen.getByTestId('roleplay-composer-send'))

    await waitFor(() => {
      expect(screen.getByTestId('roleplay-message-3')).toHaveTextContent('她没有立刻反驳，只是把质问压低成一声叹息。')
    })

    expect(screen.getByPlaceholderText('输入角色台词、动作，或你希望推动的剧情。⌘/Ctrl + Enter 发送')).toHaveValue('')
    const rewritePayload = rewritePayloads[0]
    if (!rewritePayload) throw new Error('Rewrite payload was not captured')
    expect(rewritePayload).toMatchObject({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      operationType: 'roleplay',
      userInstruction: '别再躲了，给我一个真正的解释。',
      scope: 'chapter',
      mode: 'dialogue',
      tone: 'dramatic',
    })
    expect(rewritePayload.generatedText).toBeUndefined()
    expect(rewritePayload.continueBlockId).toBeUndefined()
    expect(rewritePayload.targetChapterNo).toBeUndefined()
    expect(rewritePayload.roleplayMessages).toEqual([
      { role: 'user', content: '你昨晚为什么没有按约定现身？' },
      { role: 'assistant', content: '我到了，只是先确认街角没有埋伏。' },
    ])
  })
})
