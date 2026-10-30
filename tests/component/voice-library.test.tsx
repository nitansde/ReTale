// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoleplayVoiceSettings } from '@/components/workspace/RoleplayVoiceSettings'
import { DEFAULT_VOICE_SETTINGS } from '@/lib/voice-chat'

afterEach(() => vi.unstubAllGlobals())
describe('voice library editor', () => {
  it('adds a voice with a name and gender, saves it, and exposes it in the quick selector', async () => {
    const settings = { ...DEFAULT_VOICE_SETTINGS, sonioxConfigured: false, qwenConfigured: false, fishConfigured: true }
    const saved = vi.fn()
    const fetchMock = vi.fn(async (_url, init) => Response.json({ ...settings, ...JSON.parse(init.body) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<RoleplayVoiceSettings settings={settings} onSaved={saved} />)
    fireEvent.change(screen.getAllByLabelText('名称').at(-1)!, { target: { value: '自定义男声' } })
    fireEvent.change(screen.getAllByLabelText('音色 ID').at(-1)!, { target: { value: 'custom-id' } })
    expect(screen.queryByLabelText('备注')).not.toBeInTheDocument()
    fireEvent.change(screen.getAllByLabelText('性别').at(-1)!, { target: { value: 'male' } })
    fireEvent.click(screen.getByRole('button', { name: '添加音色' }))
    const select = screen.getByRole('combobox', { name: '音色' })
    expect(select).toHaveValue('custom-id')
    expect(within(select).getByRole('group', { name: '男声' })).toHaveTextContent('自定义男声 · 中文')
    fireEvent.click(screen.getByRole('button', { name: '保存语音设置' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(saved.mock.calls[0][0]).toMatchObject({ voiceId: 'custom-id', voices: expect.arrayContaining([{ id: 'custom-id', name: '自定义男声', gender: 'male', language: 'zh' }]) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).fishApiKey).toBe('')
  })
})
