// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoleplaySessionView } from '@/components/workspace/RoleplaySessionView'
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
function setup(options: { messages?: ReturnType<typeof message>[]; candidates?: boolean; fail?: boolean; json?: boolean } = {}) {
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
      const next = message(detail.messages.length + 1, body.turn ? { turn: body.turn } : { script: body.script }, body.parentMessageId)
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
  const view = render(<RoleplaySessionView novelId="novel" branchId="novel:main" sessionId="session" anchorChapterNo={3} />)
  return { detail, requests, previews, fetchMock, ...view }
}
async function chooseCast() {
  await screen.findByTestId('roleplay-cast-picker')
  fireEvent.click(screen.getAllByRole('button', { name: '沈月' })[1]!)
  fireEvent.click(screen.getByRole('button', { name: '进入故事' }))
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('roleplay script view', () => {
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
    expect(screen.getByText('林舟 ↔ 自定义角色')).toBeInTheDocument()
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
    fireEvent.click(screen.getAllByRole('button', { name: '重试这一段' })[1]!)
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
})
function turnData() { return { turn } }
