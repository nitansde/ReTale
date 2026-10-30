import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceMessagePlayer } from '@/lib/voice-message-player'

const source = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, buffer: null }
const context = { state: 'running', destination: {}, resume: vi.fn(async () => {}), suspend: vi.fn(async () => {}), close: vi.fn(async () => {}), createBufferSource: () => source, decodeAudioData: vi.fn(async () => ({})) }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('AudioContext', class { constructor() { return context } }); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2])))) })
afterEach(() => vi.unstubAllGlobals())

describe('reply playback', () => {
  it('pauses and resumes at the existing position without synthesizing a second time', async () => {
    const changed = vi.fn(); const failed = vi.fn(); const player = new VoiceMessagePlayer(changed, failed)
    await player.play('你好')
    expect(changed).toHaveBeenLastCalledWith('playing')
    await player.toggle(); expect(context.suspend).toHaveBeenCalledOnce(); expect(changed).toHaveBeenLastCalledWith('paused')
    await player.toggle(); expect(changed).toHaveBeenLastCalledWith('playing')
    expect(fetch).toHaveBeenCalledOnce(); expect(source.start).toHaveBeenCalledOnce()
    source.onended!(); expect(context.close).toHaveBeenCalledOnce(); expect(changed).toHaveBeenLastCalledWith('idle')
    expect(failed).not.toHaveBeenCalled()
  })
  it('honors pause while loading and cancels playback during navigation', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    const changed = vi.fn(); const player = new VoiceMessagePlayer(changed, vi.fn())
    const playing = player.play('你好'); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await player.toggle()
    resolve(new Response(new Uint8Array([1, 2]))); await playing
    expect(changed).toHaveBeenLastCalledWith('paused')
    player.stop(); expect(source.stop).toHaveBeenCalledOnce(); expect(changed).toHaveBeenLastCalledWith('idle')
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('leaves the call audio session so a reply after a call is not quiet', async () => {
    const audioSession = { type: 'play-and-record' }
    vi.stubGlobal('navigator', { audioSession })
    await new VoiceMessagePlayer(vi.fn(), vi.fn()).play('你好')
    expect(audioSession.type).toBe('playback')
  })
  it('never starts stale audio after being stopped during a pending request', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    const failed = vi.fn(); const player = new VoiceMessagePlayer(vi.fn(), failed)
    const playing = player.play('你好'); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    player.stop(); resolve(new Response(new Uint8Array([1, 2]))); await playing
    expect(source.start).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled()
  })
})
