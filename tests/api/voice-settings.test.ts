import { beforeEach, describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/server/persistence', () => ({
  findAppSettings: (keys: string[]) => keys.filter((key) => store.has(key)).map((key) => ({ key, value: store.get(key) })),
  upsertAppSettings: async (entries: [string, string][]) => entries.forEach(([key, value]) => store.set(key, value)),
}))
import { GET, POST } from '@/app/api/settings/voice/route'
import { DEFAULT_VOICE_SETTINGS } from '@/lib/voice-chat'
import { loadVoiceSettings } from '@/lib/server/voice/settings'
const request = (body: unknown, origin = 'http://localhost') => new Request('http://localhost/api/settings/voice', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
beforeEach(() => store.clear())

describe('voice settings API', () => {
  it('defaults to the current models and four named voices without shipping credentials', async () => {
    expect(DEFAULT_VOICE_SETTINGS).toMatchObject({ asrProvider: 'qwen', qwenModel: 'qwen3-asr-flash-realtime', fishModel: 's2.1-pro-free', sonioxApiKey: '', qwenApiKey: '', fishApiKey: '' })
    expect(DEFAULT_VOICE_SETTINGS.voices.map(({ name, gender, language }) => ({ name, gender, language }))).toEqual([
      { name: '学姐', gender: 'female', language: 'zh' }, { name: 'Sarah', gender: 'female', language: 'en' },
      { name: '梓轩', gender: 'male', language: 'zh' }, { name: 'Adrin', gender: 'male', language: 'en' },
    ])
    expect((await (await GET()).json()).voiceId).toBe('7f92f8afb8ec43bf81429cc1c9199cb1')
  })
  it('upgrades old settings without losing keys or custom voice selections', () => {
    const old = { ...DEFAULT_VOICE_SETTINGS, voices: undefined }
    store.set('VOICE_SETTINGS_V1', JSON.stringify({ ...old, fishApiKey: 'kept-secret', voiceId: 'custom' }))
    expect(loadVoiceSettings()).toMatchObject({ fishApiKey: 'kept-secret', voiceId: 'custom', voices: DEFAULT_VOICE_SETTINGS.voices })
    store.set('VOICE_SETTINGS_V1', JSON.stringify({ ...old, language: 'en', voiceId: '' }))
    expect(loadVoiceSettings().voiceId).toBe('933563129e564b19a115bedd57b7406a')
  })
  it('persists names and gender, switches independently of keys, and rejects duplicate IDs', async () => {
    const voices = [...DEFAULT_VOICE_SETTINGS.voices, { id: 'custom', name: '自定义', gender: 'male', language: 'zh' }]
    expect((await POST(request({ voices, fishApiKey: 'kept-secret' }))).status).toBe(200)
    await POST(request({ voiceId: 'custom' }))
    expect(loadVoiceSettings()).toMatchObject({ voices, voiceId: 'custom', fishApiKey: 'kept-secret' })
    expect((await POST(request({ voices: [...voices, voices[0]] }))).status).toBe(400)
    expect((await POST(request({ voices: [{ ...voices[0], gender: 'invalid' }] }))).status).toBe(400)
    await POST(request({ voices: [], voiceId: '' }))
    expect(loadVoiceSettings()).toMatchObject({ voices: [], voiceId: '', fishApiKey: 'kept-secret' })
  })
  it('stores secrets, never returns them, preserves blank passwords and supports explicit clearing', async () => {
    const response = await POST(request({ ...DEFAULT_VOICE_SETTINGS, sonioxApiKey: 'soniox-secret', fishApiKey: 'fish-secret', voiceId: 'voice' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sonioxConfigured: true, fishConfigured: true, voiceId: 'voice' })
    const read = await GET(); const data = await read.json()
    expect(JSON.stringify(data)).not.toContain('secret'); expect(data).not.toHaveProperty('fishApiKey')
    expect(read.headers.get('cache-control')).toBe('no-store')
    await POST(request({ fishApiKey: '', silenceMs: 800 }))
    expect(loadVoiceSettings().fishApiKey).toBe('fish-secret')
    await POST(request({ clear_fishApiKey: true }))
    expect(loadVoiceSettings().fishApiKey).toBe('')
  })
  it('rejects external origins, invalid endpoint hosts, excessive waits and malformed JSON', async () => {
    expect((await POST(request({}, 'https://evil.test'))).status).toBe(403)
    expect((await POST(request({ qwenUrl: 'wss://evil.test/api' }))).status).toBe(400)
    expect((await POST(request({ silenceMs: 99999 }))).status).toBe(400)
    const malformed = await POST(new Request('http://localhost/api/settings/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' }))
    expect(malformed.status).toBe(400); expect(store.size).toBe(0)
  })
})
