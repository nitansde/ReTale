import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VOICE_SETTINGS, type VoiceEvent } from '@/lib/voice-chat'
import { speakModelStream } from '@/lib/server/voice/reply'
import { voiceEventStream } from '@/lib/server/voice/event-stream'

const settings = { ...DEFAULT_VOICE_SETTINGS, fishApiKey: 'secret', voiceId: 'voice-1' }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('voice synthesis pipeline', () => {
  it('streams first audio before the model finishes and keeps sentence completion ordered', async () => {
    let model!: ReadableStreamDefaultController<Uint8Array>
    let audio!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { model = controller; model.enqueue(encoder.encode('你好。后半')) } })
    const fetchMock = vi.fn().mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { audio = c; c.enqueue(new Uint8Array([0, 1])) } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([2, 3])))
    vi.stubGlobal('fetch', fetchMock)
    const events: VoiceEvent[] = []
    const operation = speakModelStream(stream, settings, (event) => events.push(event), new AbortController().signal)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'audio')).toBe(true))
    expect(events.some((event) => event.type === 'done')).toBe(false)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ text: '你好。', format: 'pcm', sample_rate: 24000, reference_id: 'voice-1' })
    model.enqueue(encoder.encode('句。')); model.close(); audio.close()
    await operation
    expect(events.map((event) => event.type)).toEqual(['text', 'audio', 'segment-end', 'text', 'audio', 'segment-end', 'done'])
  })
  it('requests the next sentence while the current one streams, two at most, and still emits in order', async () => {
    const encoder = new TextEncoder()
    const audio: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { audio.push(c) } })))
    vi.stubGlobal('fetch', fetchMock)
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode('嗯。我在。你呢？')); c.close() } })
    const events: VoiceEvent[] = []
    const operation = speakModelStream(stream, settings, (event) => events.push(event), new AbortController().signal)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(events.filter((event) => event.type === 'text')).toEqual([{ type: 'text', text: '嗯。', segment: 0 }])
    audio[1].enqueue(new Uint8Array([2, 3])); audio[1].close()
    audio[0].enqueue(new Uint8Array([0, 1])); audio[0].close()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    audio[2].enqueue(new Uint8Array([4, 5])); audio[2].close()
    await operation
    expect(events.filter((event) => event.type !== 'audio').map((event) => event.type === 'text' || event.type === 'segment-end' ? `${event.type}:${event.segment}` : event.type))
      .toEqual(['text:0', 'segment-end:0', 'text:1', 'segment-end:1', 'text:2', 'segment-end:2', 'done'])
  })
  it('cancels the model reader and in-flight TTS on interruption', async () => {
    const abort = new AbortController(); const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('你好。还')) }, cancel: cancelled })
    let upstreamSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init) => { upstreamSignal = init.signal; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }))
    const operation = speakModelStream(stream, settings, () => {}, abort.signal)
    const rejected = expect(operation).rejects.toThrow('Aborted')
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined())
    abort.abort(); await rejected
    expect(upstreamSignal?.aborted).toBe(true); expect(cancelled).toHaveBeenCalledOnce()
  })
  it('skips sentences Fish returns no audio for and only emits whole PCM16 samples', async () => {
    const split = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); c.enqueue(new Uint8Array([2, 3])); c.close() } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([]))).mockResolvedValueOnce(new Response(split)))
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('嗯。你好。')); c.close() } })
    const events: VoiceEvent[] = []
    await speakModelStream(stream, settings, (event) => events.push(event), new AbortController().signal)
    // Segment 0 had no audio: never ended (so never "heard"), and the turn still completes.
    expect(events.filter((event) => event.type !== 'text')).toEqual([
      { type: 'audio', segment: 1, sampleRate: 24000, audio: Buffer.from([1, 2]).toString('base64') }, { type: 'segment-end', segment: 1 }, { type: 'done' },
    ])
  })
  it('shows descriptions without voicing them and sends only the spoken part to Fish', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(init.body as string).text); return new Response(new Uint8Array([0, 1])) }))
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('（她笑了笑。）（低声）你好。*点头*')); c.close() } })
    const events: VoiceEvent[] = []
    await speakModelStream(stream, settings, (event) => events.push(event), new AbortController().signal)
    expect(sent).toEqual(['你好。'])
    expect(events.filter((event) => event.type !== 'audio')).toEqual([
      { type: 'text', text: '（她笑了笑。）', segment: 0, silent: true }, { type: 'text', text: '（低声）你好。', segment: 1 }, { type: 'segment-end', segment: 1 },
      { type: 'text', text: '*点头*', segment: 2, silent: true }, { type: 'done' },
    ])
  })
  it('skips narration outside dialogue quotes, even before the first quote', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(init.body as string).text); return new Response(new Uint8Array([0, 1])) }))
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('她叹了口气。\n她转身道：「走吧。」')); c.close() } })
    const events: VoiceEvent[] = []
    await speakModelStream(stream, settings, (event) => events.push(event), new AbortController().signal)
    expect(sent).toEqual(['走吧。'])
    expect(events.filter((event) => event.type === 'text')).toEqual([
      { type: 'text', text: '她叹了口气。', segment: 0, silent: true }, { type: 'text', text: '她转身道：「走吧。」', segment: 1 },
    ])
  })
  it('propagates downstream cancellation into the service signal', async () => {
    let serviceSignal!: AbortSignal
    const stream = voiceEventStream(new AbortController().signal, async (emit, signal) => {
      serviceSignal = signal; emit({ type: 'ping' }); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    })
    const reader = stream.getReader(); await reader.read(); await reader.cancel()
    expect(serviceSignal.aborted).toBe(true)
  })
})
