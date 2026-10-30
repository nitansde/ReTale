import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VOICE_SETTINGS } from '@/lib/voice-chat'
const fixture = vi.hoisted(() => ({ settings: {} }))
vi.mock('@/lib/server/voice/settings', async (original) => ({ ...await original<typeof import('@/lib/server/voice/settings')>(), loadVoiceSettings: () => fixture.settings }))
import { POST } from '@/app/api/roleplay/voice/speak/route'

const request = (text: unknown, origin = 'http://localhost') => new Request('http://localhost/api/roleplay/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ text }) })
beforeEach(() => { fixture.settings = { ...DEFAULT_VOICE_SETTINGS, fishApiKey: 'server-secret' } })
afterEach(() => vi.unstubAllGlobals())

describe('reading existing replies', () => {
  it('uses Fish without an ASR key or model generation and excludes thoughts from speech', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(request('（我很紧张）我找到线索了。'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.fish.audio/v1/tts')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ text: '我找到线索了。', reference_id: DEFAULT_VOICE_SETTINGS.voiceId, format: 'mp3', sample_rate: 44100 })
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ model: 's2.1-pro-free', Authorization: 'Bearer server-secret' })
  })
  it('rejects unconfigured, cross-origin and invalid requests before contacting Fish', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    for (const text of ['', null, 'x'.repeat(16001), '（只含心声）']) expect((await POST(request(text))).status).toBe(400)
    expect((await POST(request('你好', 'https://evil.test'))).status).toBe(403)
    fixture.settings = DEFAULT_VOICE_SETTINGS
    expect((await POST(request('你好'))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not expose upstream error details or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server-secret', { status: 401 })))
    const response = await POST(request('你好'))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('server-secret')
  })
})
