import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VOICE_SETTINGS, type VoiceEvent } from '@/lib/voice-chat'

const sockets = vi.hoisted(() => [] as Array<{
  url: URL; options: { headers?: Record<string, string> }; readyState: number; bufferedAmount: number
  emit: (name: string, ...args: unknown[]) => void; send: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>
}>)
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: class extends EventEmitter {
    static OPEN = 1
    readyState = 1; bufferedAmount = 0
    send = vi.fn(); terminate = vi.fn(() => { this.readyState = 3 })
    constructor(public url: URL, public options: { headers?: Record<string, string> }) { super(); sockets.push(this) }
  } }
})
import { closeVoiceAsr, pushVoiceAudio, transcribeVoice } from '@/lib/server/voice/asr'
afterEach(() => { sockets.splice(0); vi.restoreAllMocks() })

describe('persistent voice recognition relay', () => {
  it('keeps Soniox credentials server-side, forwards ordered PCM and cleans up on abort', async () => {
    const events: VoiceEvent[] = []; const abort = new AbortController()
    const operation = transcribeVoice({ ...DEFAULT_VOICE_SETTINGS, sonioxApiKey: 'secret-soniox' }, ['林舟'], (event) => events.push(event), abort.signal)
    const socket = sockets[0]; socket.emit('open')
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ api_key: 'secret-soniox', sample_rate: 16000, context: { terms: ['林舟'] }, enable_endpoint_detection: true })
    const ready = events.find((event) => event.type === 'ready')!
    if (ready.type !== 'ready') throw new Error('Missing ready event')
    expect(pushVoiceAudio(ready.sessionId, new Uint8Array([1, 2]), 1)).toBe('sequence')
    expect(pushVoiceAudio(ready.sessionId, new Uint8Array([1, 2]), 0)).toBe('ok')
    expect(socket.send.mock.calls[1][0]).toEqual(new Uint8Array([1, 2]))
    expect(JSON.stringify(events)).not.toContain('secret-soniox')
    abort.abort(); await operation
    expect(socket.terminate).toHaveBeenCalledOnce()
    expect(pushVoiceAudio(ready.sessionId, new Uint8Array([1, 2]), 1)).toBe('expired')
  })
  it('waits for Qwen session.updated before capture and sends base64 PCM', async () => {
    const events: VoiceEvent[] = []; const abort = new AbortController()
    const operation = transcribeVoice({ ...DEFAULT_VOICE_SETTINGS, asrProvider: 'qwen', qwenApiKey: 'secret-qwen' }, [], (event) => events.push(event), abort.signal)
    const socket = sockets[0]; socket.emit('open')
    expect(socket.options.headers?.Authorization).toBe('Bearer secret-qwen')
    expect(events).toHaveLength(0)
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'session.update', session: { input_audio_format: 'pcm', turn_detection: { silence_duration_ms: 500 } } })
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
    const ready = events[0]
    if (ready.type !== 'ready') throw new Error('Missing ready event')
    pushVoiceAudio(ready.sessionId, new Uint8Array([1, 2]), 0)
    expect(JSON.parse(socket.send.mock.calls[1][0])).toMatchObject({ type: 'input_audio_buffer.append', audio: 'AQI=' })
    closeVoiceAsr(ready.sessionId); await operation
  })
  it('rejects provider failures without returning raw messages that could contain credentials', async () => {
    const abort = new AbortController()
    const operation = transcribeVoice({ ...DEFAULT_VOICE_SETTINGS, sonioxApiKey: 'secret' }, [], () => {}, abort.signal)
    const rejected = expect(operation).rejects.toThrow('rejected the voice stream')
    sockets[0].emit('message', Buffer.from(JSON.stringify({ error_code: 401, error_message: 'secret' })))
    await rejected
    expect(sockets[0].terminate).toHaveBeenCalledOnce()
  })
})
