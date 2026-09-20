// @vitest-environment jsdom
import React, { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoleplaySessionView, type RoleplaySessionControls } from '@/components/workspace/RoleplaySessionView'
import { type RoleplayTurn, type RoleplayScript, roleplayScriptText } from '@/lib/roleplay-script'

const cast = { playerName: '林舟', counterpartName: '沈月' }
const turn: RoleplayTurn = { ...cast, storyGuidance: '雨夜，他推开门。', dialogue: '你在等我？', maxCharacters: 600 }
const script: RoleplayScript = { ...cast, blocks: [
  { type: 'narration', text: '雨水沿着屋檐滑落。' },
  { type: 'narration', text: '屋里的灯晃了一下。' },
  { type: 'counterpart', text: '她抬起头，轻声道：“我一直在这里。”' },
  { type: 'player', text: '他伸出手。“那就一起走吧。”' },
  { type: 'counterpart', text: '好。' },
] }
const savedScript: RoleplayScript = { ...script, blocks: [{ type: 'narration', text: '雨水沿着屋檐滑落。\n\n屋里的灯晃了一下。' }, ...script.blocks.slice(2)] }
function message(index: number, data: { turn: RoleplayTurn } | { script: RoleplayScript }, parentMessageId: string | null = null) {
  return { id: `m${index}`, sessionId: 'session', messageIndex: index, turnIndex: index, variantIndex: 1, role: 'turn' in data ? 'user' : 'assistant',
    content: 'turn' in data ? data.turn.dialogue : roleplayScriptText(data.script), parentMessageId, forkedFromMessageId: null, variantGroupId: null, ...data }
}
function setup(options: { messages?: ReturnType<typeof message>[]; candidates?: boolean; fail?: boolean; json?: boolean; deleteFail?: boolean; deleteWait?: Promise<void> } = {}) {
  const detail = { id: 'session', title: 'RP-01', sourceChapterNo: 3,
    sourceSnapshot: { chapterId: 'chapter', chapterNo: 3, selectedText: '雨夜相逢', textSnapshot: '雨夜相逢正文' },
    characterOptions: options.candidates === false ? [] : [{ name: '林舟', protagonist: true }, { name: '沈月', protagonist: false }],
    messages: options.messages ?? [],
  }
  let fail = options.fail ?? false
  const requests: Record<string, unknown>[] = []
  const previews: Record<string, unknown>[] = []
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('/api/writing-skills')) return Response.json({ cards: [{ id: 'skill', title: '神态描写', summary: '通过眼神和动作推进对话。' }] })
    if (String(url) === '/api/roleplay/preview') {
      const body = JSON.parse(String(init?.body)); previews.push(body)
      const options = body.roleplayTurn.generationOptions
      return Response.json({ ok: true, contextSnapshotId: 'snapshot', systemPrompt: 'RP script', userPrompt: options.writingSkillCardIds.includes('skill') ? '神态方法与范文已加入' : '当前故事', writingSkillRecords: [], promptBlocks: [
        { id: 'current-summary', label: '当前章节摘要', content: '前情内容', priority: 'high', enabled: !options.disabledBlockIds.includes('current-summary'), required: false, trimmed: false },
        { id: 'roleplay-history', label: '当前角色扮演对话', content: '已发生的对话', priority: 'highest', enabled: true, required: true, trimmed: false },
      ] })
    }
    if (String(url).includes('/messages')) {
      const body = JSON.parse(String(init?.body))
      if (init?.method === 'DELETE') {
        await options.deleteWait
        if (options.deleteFail) return Response.json({ error: 'Delete failed' }, { status: 500 })
        const request = detail.messages.find((item) => item.id === body.messageId)!
        const deletedMessageIds = detail.messages.filter((item) => item.id === request.id || (item.role === 'assistant' && item.parentMessageId === request.id)).map((item) => item.id)
        detail.messages = detail.messages.filter((item) => !deletedMessageIds.includes(item.id)).map((item) => ({
          ...item, parentMessageId: item.parentMessageId && deletedMessageIds.includes(item.parentMessageId) ? request.parentMessageId : item.parentMessageId,
        }))
        return Response.json({ ok: true, deletedMessageIds })
      }
      const next = message(Math.max(0, ...detail.messages.map((item) => item.messageIndex)) + 1, body.turn ? { turn: body.turn } : { script: body.script }, body.parentMessageId)
      detail.messages.push(next)
      return Response.json(next)
    }
    if (String(url) === '/api/rewrite') {
      requests.push(JSON.parse(String(init?.body)))
      if (fail) { fail = false; return new Response('{broken json', { headers: { 'Content-Type': 'text/plain' } }) }
      const content = JSON.stringify({ blocks: script.blocks })
      return options.json ? Response.json({ provider: 'test', metadata: { debug: 'DO_NOT_RENDER' }, candidates: [{ content }] }) : new Response(content, { headers: { 'Content-Type': 'text/plain' } })
    }
    return Response.json(detail)
  })
  vi.stubGlobal('fetch', fetchMock)
  const controlsRef = createRef<RoleplaySessionControls>()
  const view = render(<RoleplaySessionView novelId="novel" branchId="novel:main" sessionId="session" anchorChapterNo={3} controlsRef={controlsRef} />)
  return { detail, requests, previews, fetchMock, controlsRef, ...view }
}
async function chooseCast() {
  await screen.findByTestId('roleplay-cast-picker')
  fireEvent.click(screen.getAllByRole('button', { name: '沈月' })[1]!)
  fireEvent.click(screen.getByRole('button', { name: '进入故事' }))
}
beforeEach(() => { window.localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('roleplay script view', () => {
  it('expands the compact composer on focus, keeps drafts when collapsed, and collapses after sending', async () => {
    const { requests } = setup({ messages: [message(1, turnData()), message(2, { script }, 'm1')] })
    await screen.findByTestId('roleplay-script')
    const input = screen.getByRole('textbox', { name: '我的台词' })
    expect(input).toHaveAttribute('rows', '1')
    expect(screen.queryByRole('textbox', { name: '故事引导' })).not.toBeInTheDocument()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '继续说。' } })
    fireEvent.change(screen.getByRole('textbox', { name: '故事引导' }), { target: { value: '她走向窗边。' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '本次目标字数' }), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: '收起输入框' }))
    expect(input).toHaveValue('继续说。')
    expect(input).toHaveAttribute('rows', '1')
    fireEvent.click(input)
    expect(screen.getByRole('textbox', { name: '故事引导' })).toHaveValue('她走向窗边。')
    expect(screen.getByRole('spinbutton')).toHaveValue(400)
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await screen.findByTestId('roleplay-message-3')
    expect(screen.getByTestId('roleplay-composer')).toHaveAttribute('data-expanded', 'false')
    expect(requests[0]).toMatchObject({ roleplayTurn: { dialogue: '继续说。', storyGuidance: '她走向窗边。', maxCharacters: 400 } })
  })
  it('opens character selection from the shared header controls without replacing the conversation', async () => {
    const { controlsRef } = setup({ messages: [message(1, turnData()), message(2, { script }, 'm1')] })
    await screen.findByTestId('roleplay-script')
    expect(screen.queryByRole('button', { name: '对话来源' })).not.toBeInTheDocument()
    act(() => controlsRef.current?.openCastPicker())
    const dialog = screen.getByRole('dialog', { name: '选择对话角色' })
    expect(within(dialog).getByRole('textbox', { name: '对方角色' })).toHaveValue('沈月')
    fireEvent.change(within(dialog).getByRole('textbox', { name: '对方角色' }), { target: { value: '新角色' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '进入故事' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.focus(screen.getByRole('textbox', { name: '我的台词' }))
    expect(screen.getByText('对 新角色 说')).toBeInTheDocument()
    expect(screen.getByTestId('roleplay-script')).toBeInTheDocument()
  })
  it('shows delete on each request and only regenerates from the latest request', async () => {
    setup({ messages: [message(1, turnData()), message(2, { script }, 'm1'), message(3, turnData(), 'm2'), message(4, { script }, 'm3')] })
    await screen.findByTestId('roleplay-message-3')
    expect(screen.getAllByRole('button', { name: /^删除请求/ })).toHaveLength(2)
    expect(within(screen.getByTestId('roleplay-message-0')).queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('roleplay-message-2')).getByRole('button', { name: '重新生成' })).toBeEnabled()
    expect(within(screen.getByTestId('roleplay-message-3')).queryByRole('button', { name: /^删除请求/ })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('roleplay-regenerate-last')).toHaveLength(1)
  })
  it('deletes a request with its variants, clears a removed fork and persists an empty conversation', async () => {
    const view = setup({ messages: [message(1, turnData()), message(2, { script }, 'm1'), message(3, turnData(), 'm2'), message(4, { script }, 'm3'), message(5, { script }, 'm3')] })
    await screen.findByTestId('roleplay-message-4')
    fireEvent.click(screen.getByRole('button', { name: '从 #3 分叉' }))
    fireEvent.click(screen.getByRole('button', { name: '删除请求 #3' }))
    await waitFor(() => expect(screen.queryByTestId('roleplay-message-2')).not.toBeInTheDocument())
    expect(view.detail.messages.map((item) => item.id)).toEqual(['m1', 'm2'])
    expect(screen.queryByTestId('roleplay-fork-anchor')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('roleplay-message-0')).getByRole('button', { name: '重新生成' })).toBeEnabled()
    expect(view.fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')?.[1]).toMatchObject({ body: JSON.stringify({ novelId: 'novel', branchId: 'novel:main', messageId: 'm3' }) })
    fireEvent.click(screen.getByRole('button', { name: '删除请求 #1' }))
    await screen.findByTestId('roleplay-empty-state')
    expect(screen.queryByTestId('roleplay-regenerate-last')).not.toBeInTheDocument()
    expect(view.detail.messages).toHaveLength(0)
    view.unmount()
    setup({ messages: view.detail.messages })
    await chooseCast()
    expect(screen.getByTestId('roleplay-empty-state')).toBeInTheDocument()
  })
  it('keeps messages on deletion failure and prevents concurrent actions while deleting', async () => {
    let finishDelete!: () => void
    const deleteWait = new Promise<void>((resolve) => { finishDelete = resolve })
    const view = setup({ messages: [message(1, turnData()), message(2, { script }, 'm1')], deleteFail: true, deleteWait })
    await screen.findByTestId('roleplay-script')
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: '下一段' } })
    fireEvent.click(screen.getByRole('button', { name: '删除请求 #1' }))
    expect(screen.getByRole('button', { name: '删除请求 #1' })).toBeDisabled()
    expect(screen.getByTestId('roleplay-regenerate-last')).toBeDisabled()
    expect(screen.getByTestId('roleplay-composer-send')).toBeDisabled()
    expect(screen.queryByTestId('roleplay-pending-reply')).not.toBeInTheDocument()
    finishDelete()
    await screen.findByRole('alert')
    expect(view.detail.messages).toHaveLength(2)
    expect(screen.getByTestId('roleplay-script')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除请求 #1' })).toBeEnabled()
    expect(screen.getByTestId('roleplay-composer-send')).toBeEnabled()
  })
  it('selects skills, previews and disables context, persists the settings and reuses them after reopening', async () => {
    const first = setup()
    await chooseCast()
    fireEvent.click(screen.getByRole('button', { name: '写作技巧' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /神态描写/ }))
    fireEvent.change(screen.getByRole('combobox', { name: '每张卡范文数' }), { target: { value: '2' } })
    await waitFor(() => expect(first.previews.at(-1)?.roleplayTurn).toMatchObject({ generationOptions: { writingSkillCardIds: ['skill'], writingSkillExampleCount: 2 } }))
    fireEvent.click(screen.getByRole('button', { name: '关闭写作技巧' }))
    fireEvent.click(screen.getByRole('button', { name: '高级上下文' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '当前章节摘要' }))
    expect(screen.getByRole('checkbox', { name: '当前角色扮演对话' })).toBeDisabled()
    await waitFor(() => expect(first.previews.at(-1)?.roleplayTurn).toMatchObject({ generationOptions: { disabledBlockIds: ['current-summary'] } }))
    await screen.findByTestId('roleplay-final-prompt')
    fireEvent.click(screen.getByRole('button', { name: '关闭高级上下文' }))
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: '继续吧。' } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await waitFor(() => expect(first.detail.messages).toHaveLength(2))
    const firstMessage = first.detail.messages[0]
    if (!('turn' in firstMessage)) throw new Error('Expected a saved user turn')
    const savedOptions = firstMessage.turn.generationOptions
    expect(first.requests[0]).toMatchObject({ contextSnapshotId: 'snapshot', roleplayTurn: { generationOptions: savedOptions }, writingSkillCardIds: ['skill'], writingSkillExampleCount: 2, disabledBlockIds: ['current-summary'] })
    first.unmount()
    const reopened = setup({ messages: first.detail.messages })
    await screen.findByTestId('roleplay-script')
    fireEvent.click(screen.getByRole('button', { name: '写作技巧 · 1' }))
    expect(await screen.findByRole('checkbox', { name: /神态描写/ })).toBeChecked()
    expect(screen.getByRole('combobox', { name: '每张卡范文数' })).toHaveValue('2')
    fireEvent.click(screen.getByRole('button', { name: '关闭写作技巧' }))
    fireEvent.click(screen.getByTestId('roleplay-regenerate-last'))
    await waitFor(() => expect(reopened.requests).toHaveLength(1))
    expect(reopened.requests[0]).toMatchObject({ roleplayTurn: { generationOptions: savedOptions }, writingSkillCardIds: ['skill'], disabledBlockIds: ['current-summary'] })
    await waitFor(() => expect(reopened.detail.messages).toHaveLength(3))
  })
  it('offers the protagonist, chapter characters and custom names, and requires two distinct roles', async () => {
    setup()
    await screen.findByTestId('roleplay-cast-picker')
    expect(screen.getByRole('textbox', { name: '我扮演的角色' })).toHaveValue('林舟')
    expect(screen.getByRole('button', { name: '进入故事' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '对方角色' }), { target: { value: '林舟' } })
    expect(screen.getByRole('alert')).toHaveTextContent('请选择两个不同的角色')
    fireEvent.change(screen.getByRole('textbox', { name: '对方角色' }), { target: { value: '自定义角色' } })
    fireEvent.click(screen.getByRole('button', { name: '进入故事' }))
    fireEvent.focus(screen.getByRole('textbox', { name: '我的台词' }))
    expect(screen.getByText('对 自定义角色 说')).toBeInTheDocument()
  })
  it('allows entering both names when chapter knowledge is unavailable', async () => {
    setup({ candidates: false })
    await screen.findByText('本章角色信息不足，请输入双方的角色姓名。')
    fireEvent.change(screen.getByRole('textbox', { name: '我扮演的角色' }), { target: { value: '甲' } })
    fireEvent.change(screen.getByRole('textbox', { name: '对方角色' }), { target: { value: '乙' } })
    fireEvent.click(screen.getByRole('button', { name: '进入故事' }))
    expect(screen.getByTestId('roleplay-chat-core')).toBeInTheDocument()
  })
  it.each([false, true])('saves separate guidance and dialogue, renders all three block types and hides transport JSON (json=%s)', async (json) => {
    const { requests, detail } = setup({ json })
    await chooseCast()
    fireEvent.focus(screen.getByRole('textbox', { name: '我的台词' }))
    fireEvent.change(screen.getByRole('textbox', { name: '故事引导' }), { target: { value: turn.storyGuidance } })
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: turn.dialogue } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '本次目标字数' }), { target: { value: '300' } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await screen.findByTestId('roleplay-script')
    expect(requests[0]).toMatchObject({ roleplayTurn: { ...turn, maxCharacters: 300 }, presetCompatRuntimeContext: { namedTranscript: { userName: '林舟', assistantName: '沈月' } } })
    expect(detail.messages[0]).toMatchObject({ turn: { storyGuidance: turn.storyGuidance } })
    expect(document.querySelectorAll('[data-roleplay-block="narration"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-roleplay-block="player"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-roleplay-block="counterpart"]')).toHaveLength(2)
    expect(document.querySelector('[data-roleplay-block="narration"] p:last-child')?.textContent).toBe('雨水沿着屋檐滑落。\n\n屋里的灯晃了一下。')
    expect(screen.getByTestId('roleplay-script')).toHaveTextContent('她抬起头，轻声道：“我一直在这里。”')
    expect(screen.getByTestId('roleplay-script')).toHaveTextContent('他伸出手。“那就一起走吧。”')
    expect(screen.getByTestId('roleplay-message-list')).not.toHaveTextContent('DO_NOT_RENDER')
    expect(screen.getByTestId('roleplay-message-list')).not.toHaveTextContent('"blocks"')
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: '接下来去哪？' } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]?.roleplayMessages).toEqual([{ role: 'user', content: '故事引导：雨夜，他推开门。\n林舟对沈月说：你在等我？' }, { role: 'assistant', content: roleplayScriptText(savedScript) }])
    await waitFor(() => expect(detail.messages).toHaveLength(4))
  })
  it('restores cast and target length and regenerates with the original guidance and opening line', async () => {
    const { requests, detail } = setup({ messages: [message(1, turnData(), null), message(2, { script }, 'm1')] })
    await screen.findByTestId('roleplay-script')
    fireEvent.focus(screen.getByRole('textbox', { name: '我的台词' }))
    expect(screen.getByRole('spinbutton')).toHaveValue(600)
    fireEvent.click(screen.getByTestId('roleplay-regenerate-last'))
    await waitFor(() => expect(detail.messages).toHaveLength(3))
    expect(requests[0]).toMatchObject({ roleplayTurn: turn, roleplayMessages: [] })
  })
  it('continues a reopened session using complete script blocks even when the content summary is stale', async () => {
    const last = { ...message(2, { script }, 'm1'), content: '过时的摘要' }
    const { requests, detail } = setup({ messages: [message(1, turnData()), last] })
    await screen.findByTestId('roleplay-script')
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: '我们已经出门了，接下来去哪？' } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await waitFor(() => expect(detail.messages).toHaveLength(4))
    expect(requests[0]).toMatchObject({
      roleplayMessages: [
        { role: 'user', content: '故事引导：雨夜，他推开门。\n林舟对沈月说：你在等我？' },
        { role: 'assistant', content: roleplayScriptText(script) },
      ],
      presetCompatRuntimeContext: { sessionPhase: 'continue' },
    })
  })
  it.each([false, true])('retains the earlier scene when retrying or regenerating a later turn (retry=%s)', async (retry) => {
    const nextTurn = { ...turn, storyGuidance: '', dialogue: '接下来去哪？' }
    const messages = [message(1, turnData()), message(2, { script }, 'm1'), message(3, { turn: nextTurn }, 'm2')]
    if (!retry) messages.push(message(4, { script }, 'm3'))
    const { requests, detail } = setup({ messages })
    await screen.findByTestId('roleplay-message-2')
    fireEvent.click(screen.getByTestId('roleplay-regenerate-last'))
    await waitFor(() => expect(detail.messages).toHaveLength(retry ? 4 : 5))
    expect(requests[0]).toMatchObject({ roleplayTurn: nextTurn, roleplayMessages: [
      { role: 'user', content: '故事引导：雨夜，他推开门。\n林舟对沈月说：你在等我？' },
      { role: 'assistant', content: roleplayScriptText(script) },
    ] })
  })
  it('does not render malformed JSON and retries a saved user turn without duplicating it', async () => {
    const { detail } = setup({ fail: true })
    await chooseCast()
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: turn.dialogue } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await screen.findByRole('alert')
    expect(screen.getByTestId('roleplay-message-list')).not.toHaveTextContent('{broken')
    expect(detail.messages).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '重试这一段' }))
    await screen.findByTestId('roleplay-script')
    expect(detail.messages).toHaveLength(2)
  })
  it('limits history to the selected fork path', async () => {
    const { requests, detail } = setup({ messages: [message(1, turnData()), message(2, { script }, 'm1'), message(3, { turn: { ...turn, dialogue: '后来呢？' } }, 'm2'), message(4, { script }, 'm3')] })
    await screen.findByTestId('roleplay-message-3')
    fireEvent.click(screen.getByRole('button', { name: '从 #2 分叉' }))
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: '换条路。' } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await waitFor(() => expect(detail.messages).toHaveLength(6))
    expect(requests[0]?.roleplayMessages).toHaveLength(2)
    expect(JSON.stringify(requests[0]?.roleplayMessages)).not.toContain('后来呢')
  })
  it('switches complete routes, remembers the selected route on reopen, and continues only that history', async () => {
    const initial = [message(1, turnData()), message(2, { script }, 'm1'), message(3, { turn: { ...turn, dialogue: '原路继续。' } }, 'm2'), message(4, { script }, 'm3')]
    const view = setup({ messages: initial })
    await screen.findByText('原路继续。')
    fireEvent.click(screen.getByRole('button', { name: '从 #2 分叉' }))
    expect(screen.queryByText('原路继续。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消分叉，返回当前分支' }))
    expect(screen.getByText('原路继续。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '从 #2 分叉' }))
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: '换一条路。' } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await screen.findByTestId('roleplay-message-5')
    expect(screen.queryByText('原路继续。')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '当前分支' })).toHaveValue('m6')
    expect(view.detail.messages).toHaveLength(6)
    fireEvent.click(within(screen.getByTestId('roleplay-branch-switch-m5')).getByRole('button', { name: '上一个剧情分支' }))
    expect(screen.getByText('原路继续。')).toBeInTheDocument()
    expect(screen.queryByText('换一条路。')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '当前分支' })).toHaveValue('m4')
    expect(view.requests).toHaveLength(1)
    view.unmount()

    const reopened = setup({ messages: view.detail.messages })
    await screen.findByText('原路继续。')
    expect(screen.queryByText('换一条路。')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '我的台词' }), { target: { value: '沿原路再走一段。' } })
    fireEvent.click(screen.getByTestId('roleplay-composer-send'))
    await screen.findByTestId('roleplay-message-7')
    expect(reopened.detail.messages.at(-2)).toMatchObject({ parentMessageId: 'm4' })
    expect(JSON.stringify(reopened.requests[0]?.roleplayMessages)).toContain('原路继续。')
    expect(JSON.stringify(reopened.requests[0]?.roleplayMessages)).not.toContain('换一条路。')
    fireEvent.change(screen.getByRole('combobox', { name: '当前分支' }), { target: { value: 'm6' } })
    expect(screen.getByText('换一条路。')).toBeInTheDocument()
    expect(screen.queryByText('沿原路再走一段。')).not.toBeInTheDocument()
  })
  it('switches reply versions with their continuations and regenerates the selected older branch', async () => {
    const alternateScript: RoleplayScript = { ...script, blocks: [{ type: 'counterpart', text: '另一个回答。' }] }
    const view = setup({ messages: [message(1, turnData()), message(2, { script }, 'm1'), message(3, { turn: { ...turn, dialogue: '旧回答的后续。' } }, 'm2'), message(4, { script }, 'm3'), message(5, { script: alternateScript }, 'm1')] })
    await screen.findByText('另一个回答。')
    expect(screen.queryByText('旧回答的后续。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一个回复版本' }))
    expect(screen.getByText('旧回答的后续。')).toBeInTheDocument()
    expect(screen.queryByText('另一个回答。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('roleplay-regenerate-last'))
    await screen.findByTestId('roleplay-message-5')
    const variantCall = view.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && String(init.body).includes('latest-turn-variant'))
    expect(JSON.parse(String(variantCall?.[1]?.body))).toMatchObject({ sourceMessageId: 'm4', parentMessageId: 'm3' })
    expect(screen.queryByTestId('roleplay-message-3')).not.toBeInTheDocument()
    expect(view.detail.messages).toHaveLength(6)
    fireEvent.click(within(screen.getByTestId('roleplay-branch-switch-m6')).getByRole('button', { name: '上一个回复版本' }))
    expect(screen.getByTestId('roleplay-message-3')).toBeInTheDocument()
    expect(screen.queryByTestId('roleplay-message-5')).not.toBeInTheDocument()
  })
  it('recovers to a surviving branch when its selected request is deleted', async () => {
    const view = setup({ messages: [message(1, turnData()), message(2, { script }, 'm1'), message(3, { turn: { ...turn, dialogue: '分叉内容。' } }, 'm1'), message(4, { script }, 'm3')] })
    await screen.findByText('分叉内容。')
    fireEvent.click(screen.getByRole('button', { name: '删除请求 #3' }))
    await screen.findByTestId('roleplay-message-1')
    expect(screen.queryByText('分叉内容。')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '当前分支' })).not.toBeInTheDocument()
    expect(view.detail.messages.map((item) => item.id)).toEqual(['m1', 'm2'])
    expect(screen.getByTestId('roleplay-regenerate-last')).toBeEnabled()
  })
})
function turnData() { return { turn } }
