import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('microphone worklet resampling', () => {
  it.each([44100, 48000])('produces exactly 16 kHz PCM from %i Hz input without drift', (rate) => {
    const packets: Array<{ pcm: ArrayBuffer; rms: number }> = []
    let Processor!: new () => { process: (inputs: Float32Array[][]) => void }
    const sandbox = { sampleRate: rate, AudioWorkletProcessor: class { port = { postMessage: (packet: { pcm: ArrayBuffer; rms: number }) => packets.push(packet) } },
      registerProcessor: (_name: string, implementation: typeof Processor) => { Processor = implementation },
    }
    vm.runInNewContext(fs.readFileSync('public/voice-capture-worklet.js', 'utf8'), sandbox)
    const processor = new Processor()
    // Ten seconds, including incomplete final render blocks.
    for (let i = 0; i < rate * 10; i += 128) processor.process([[new Float32Array(Math.min(128, rate * 10 - i)).fill(0.5)]])
    expect(packets).toHaveLength(100)
    expect(packets.reduce((count, packet) => count + packet.pcm.byteLength, 0)).toBe(320_000)
    expect(packets[0].rms).toBeCloseTo(0.5)
    expect(new Int16Array(packets[0].pcm)[0]).toBe(16384)
  })
})

describe('voice playback', () => {
  it('starts behind a jitter buffer and marks a segment heard the moment its audio ends', async () => {
    const { VoicePcmPlayer } = await import('@/lib/voice-audio')
    const sources: { start: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = []
    const context = { state: 'running', currentTime: 1, sampleRate: 24000, destination: {},
      createBuffer: (_channels: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
      createBufferSource: () => { const source = { buffer: null, onended: null, connect() {}, disconnect() {}, stop() {}, start: vi.fn() }; sources.push(source); return source },
    } as unknown as AudioContext
    const heard: number[] = []
    const player = new VoicePcmPlayer(context, (segment) => heard.push(segment))
    player.push(btoa('\0'.repeat(4800)), 24000, 0); player.push(btoa('\0'.repeat(4800)), 24000, 0); player.endSegment(0)
    expect(sources[0].start.mock.calls[0][0]).toBeCloseTo(1.15); expect(sources[1].start.mock.calls[0][0]).toBeCloseTo(1.25)
    const drained = player.drain()
    sources.forEach((source) => source.onended!())
    // drain() is followed by stop() in a call; the last sentence must already count as heard.
    await drained; player.stop()
    expect(heard).toEqual([0])
  })

  it.each([16000, 44100, 48000])('plays the same %i Hz waveform however the PCM stream is chunked', async (rate) => {
    const { VoicePcmPlayer } = await import('@/lib/voice-audio')
    const pcm = Int16Array.from({ length: 4000 }, (_, i) => Math.round(20000 * Math.sin(i / 3) + 8000 * Math.sin(i * 1.7)))
    const encode = (samples: Int16Array) => btoa(String.fromCharCode(...new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)))
    const render = (sizes: number[]) => {
      const played: { at: number; data: Float32Array }[] = []
      const context = { state: 'running', currentTime: 0, sampleRate: rate, destination: {},
        createBuffer: (_channels: number, length: number, bufferRate: number) => { const data = new Float32Array(length); return { duration: length / bufferRate, getChannelData: () => data } },
        createBufferSource: () => { const source = { buffer: null as unknown as AudioBuffer, connect() {}, start(at: number) { played.push({ at, data: source.buffer.getChannelData(0) }) } }; return source },
      } as unknown as AudioContext
      const player = new VoicePcmPlayer(context, () => {})
      let offset = 0
      for (const size of sizes) { player.push(encode(pcm.subarray(offset, offset + size)), 24000, 0); offset += size }
      return played
    }
    const whole = render([pcm.length])
    const chunks = render([1, 1, 3, 700, 1, 1295, 2, 1997])
    let frame = chunks[0].at * rate
    for (const { at, data } of chunks) { expect(at * rate).toBeCloseTo(frame, 6); frame += data.length }
    expect(chunks.flatMap(({ data }) => [...data])).toEqual([...whole[0].data])
  })
})
