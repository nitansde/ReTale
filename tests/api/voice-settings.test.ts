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
