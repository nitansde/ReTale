export class VoicePcmPlayer {
  private nextTime = 0
  private sources = new Set<AudioBufferSourceNode>()
  private segments = new Map<number, { remaining: number; finished: boolean; carry?: number }>()
  private stopped = false
  private waiters: (() => void)[] = []
  constructor(private context: AudioContext, private completed: (segment: number) => void) {}
  push(base64: string, sampleRate: number, segment: number) {
    if (this.stopped) return
    if (sampleRate !== 24000) throw new Error('Unsupported voice sample rate')
    // iOS suspends/interrupts contexts (mic start, lock screen); a stalled
    // clock never ends sources, so playback would stay silent and never drain.
    if (this.context.state !== 'running') void this.context.resume().catch(() => undefined)
    if (this.nextTime - this.context.currentTime > 60) throw new Error('Voice playback is falling behind')
    let entry = this.segments.get(segment)
    if (!entry) { entry = { remaining: 0, finished: false }; this.segments.set(segment, entry) }
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length + (entry.carry === undefined ? 0 : 1))
    let offset = 0
    if (entry.carry !== undefined) bytes[offset++] = entry.carry
    for (let i = 0; i < raw.length; i++) bytes[offset + i] = raw.charCodeAt(i)
    entry.carry = bytes.length % 2 ? bytes[bytes.length - 1] : undefined
    const count = Math.floor(bytes.length / 2)
    if (!count) return
    const buffer = this.context.createBuffer(1, count, sampleRate)
    const floats = buffer.getChannelData(0)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < count; i++) floats[i] = view.getInt16(i * 2, true) / 32768
    const source = this.context.createBufferSource()
    source.buffer = buffer; source.connect(this.context.destination)
    entry.remaining++; this.sources.add(source)
    source.onended = () => {
      this.sources.delete(source); source.disconnect(); entry!.remaining--
      if (!this.stopped) this.checkSegment(segment)
      if (!this.sources.size) this.waiters.splice(0).forEach((resolve) => resolve())
    }
    // Start (or restart after an underrun) with a jitter buffer; a 30 ms lead
    // let every network hiccup cut a gap into the word being spoken.
    if (this.nextTime <= this.context.currentTime) this.nextTime = this.context.currentTime + 0.15
    source.start(this.nextTime); this.nextTime += buffer.duration
  }
  endSegment(segment: number) {
    const entry = this.segments.get(segment)
    if (!entry || entry.carry !== undefined) throw new Error('Incomplete voice audio segment')
    entry.finished = true; this.checkSegment(segment)
  }
  // onended fires on the audio clock after the last sample played, so a
  // finished segment with no live sources has been heard.
  private checkSegment(segment: number) {
    const entry = this.segments.get(segment)
    if (!entry || !entry.finished || entry.remaining !== 0) return
    this.segments.delete(segment); this.completed(segment)
  }
  async drain() { if (this.sources.size) await new Promise<void>((resolve) => this.waiters.push(resolve)) }
  stop() {
    this.stopped = true
    for (const source of this.sources) { source.onended = null; try { source.stop(); source.disconnect() } catch { /* Already ended. */ } }
    this.sources.clear(); this.segments.clear(); this.waiters.splice(0).forEach((resolve) => resolve())
  }
}

export async function captureVoice(context: AudioContext, onPacket: (pcm: ArrayBuffer, rms: number) => void, signal: AbortSignal) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
  let node: AudioWorkletNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let mute: GainNode | undefined
  const stop = () => {
    stream.getTracks().forEach((track) => track.stop())
    if (node) { node.port.onmessage = null; node.disconnect() }
    source?.disconnect(); mute?.disconnect()
    signal.removeEventListener('abort', stop)
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    signal.throwIfAborted()
    await context.audioWorklet.addModule('/voice-capture-worklet.js')
    signal.throwIfAborted()
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'retale-voice-capture')
    mute = context.createGain(); mute.gain.value = 0
    node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => { if (!signal.aborted) onPacket(event.data.pcm, event.data.rms) }
    source.connect(node); node.connect(mute); mute.connect(context.destination)
    return stop
  } catch (error) { stop(); throw error }
}
