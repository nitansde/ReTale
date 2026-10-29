// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceCallCallbacks, VoiceReplyResult } from '@/lib/voice-call'
const fixture = vi.hoisted(() => ({ callbacks: null as VoiceCallCallbacks | null }))
vi.mock('@/lib/voice-call', () => ({ VoiceCall: class {
  constructor(callbacks: VoiceCallCallbacks) { fixture.callbacks = callbacks }
  async start() { fixture.callbacks!.state('listening') }
  async end() { fixture.callbacks!.state('idle') }
  interrupt() {}
  setMuted() {}
} }))
import { RoleplaySessionView } from '@/components/workspace/RoleplaySessionView'
import { DEFAULT_VOICE_SETTINGS } from '@/lib/voice-chat'

beforeEach(() => { window.localStorage.clear(); Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true }); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); fixture.callbacks = null })

function setup() {
  const cast = { playerName: '林舟', counterpartName: '沈月' }
  const messages: Record<string, unknown>[] = [{ id: 'u1', role: 'user', parentMessageId: null, messageIndex: 1, content: '你好', turn: { ...cast, storyGuidance: '', dialogue: '你好', maxCharacters: 300, dialogueOnly: true } }]
  const payloads: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings/voice') return Response.json({ ...DEFAULT_VOICE_SETTINGS, sonioxConfigured: true, fishConfigured: true, qwenConfigured: false, voiceId: 'voice' })
    if (url.includes('/messages')) {
      const body = JSON.parse(String(init?.body)); payloads.push(body)
      const message = { ...body, id: `m${messages.length + 1}`, messageIndex: messages.length + 1 }
      messages.push(message); return Response.json(message)
    }
    return Response.json({ id: 'session', messages, sourceSnapshot: { chapterId: 'chapter', chapterNo: 1, selectedText: '雨夜', textSnapshot: '雨夜' }, characterOptions: [] })
  }))
  render(<RoleplaySessionView novelId="novel" branchId="novel:main" sessionId="session" anchorChapterNo={1} />)
  return { payloads, messages }
}

describe('optional voice mode in roleplay', () => {
  it('keeps the text composer as default, locks branch controls in calls and saves only heard speech', async () => {
    const { payloads } = setup()
    await screen.findByRole('textbox', { name: '我的台词' })
    fireEvent.click(screen.getByRole('button', { name: '语音聊天' }))
    expect(screen.queryByRole('textbox', { name: '我的台词' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '开始通话' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '开始通话' }))
    expect(await screen.findByRole('button', { name: '结束通话' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '文字聊天' })).toBeDisabled()
    const runReply = vi.fn().mockResolvedValue({ text: '我在这里。', interrupted: true } satisfies VoiceReplyResult)
    await act(async () => fixture.callbacks!.turn('你在哪里？', runReply))
    expect(payloads).toHaveLength(2)
    expect(payloads[0]).toMatchObject({ role: 'user', parentMessageId: 'u1', turn: { dialogue: '你在哪里？', dialogueOnly: true } })
    expect(payloads[1]).toMatchObject({ role: 'assistant', parentMessageId: 'm2', script: { voiceInterrupted: true, blocks: [{ type: 'counterpart', text: '我在这里。' }] } })
    expect(runReply.mock.calls[0][0]).toMatchObject({ roleplayLeafMessageId: 'u1', roleplaySessionId: 'session' })
    expect(screen.getByText('语音已打断')).toBeInTheDocument()
    // The next round must continue from the newly saved assistant, without stale React state.
    await act(async () => fixture.callbacks!.turn('我来了。', vi.fn().mockResolvedValue({ text: '', interrupted: true })))
    expect(payloads[2]).toMatchObject({ role: 'user', parentMessageId: 'm3' })
    expect(payloads).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '结束通话' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '文字聊天' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '文字聊天' }))
    expect(screen.getByRole('textbox', { name: '我的台词' })).toBeInTheDocument()
  })
  it('explains HTTPS requirements and disables microphone startup on insecure origins', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    setup(); fireEvent.click(await screen.findByRole('button', { name: '语音聊天' }))
    expect(await screen.findByText(/麦克风需要 HTTPS/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始通话' })).toBeDisabled()
  })
})
