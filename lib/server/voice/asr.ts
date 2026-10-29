import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import type { VoiceEvent, VoiceSettings } from '@/lib/voice-chat'

type AsrSession = { socket: WebSocket; provider: VoiceSettings['asrProvider']; nextSequence: number; touched: number; close: () => void }
// Route bundles and dev reloads must share the same live connections. This app
// runs as one persistent Node server; multi-instance hosts need session affinity.
const globalState = globalThis as typeof globalThis & { retaleVoiceAsr?: Map<string, AsrSession> }
const sessions = globalState.retaleVoiceAsr ??= new Map<string, AsrSession>()

export class AsrTranscript {
  private finalText = ''
  private speaking = false
  private completed = new Set<string>()
  constructor(private provider: VoiceSettings['asrProvider'], private emit: (event: VoiceEvent) => void) {}
  accept(data: Record<string, unknown>) {
    if (this.provider === 'qwen') {
      if (data.type === 'input_audio_buffer.speech_started') this.emit({ type: 'speech' })
      if (data.type === 'conversation.item.input_audio_transcription.text') {
        this.emit({ type: 'transcript', text: String(data.text ?? '') + String(data.stash ?? ''), final: false })
      }
      if (data.type === 'conversation.item.input_audio_transcription.completed') {
        const id = String(data.item_id ?? '')
        if (id && this.completed.has(id)) return
        if (id) this.completed.add(id)
        if (this.completed.size > 1000) this.completed.delete(this.completed.values().next().value!)
        const text = String(data.transcript ?? '').trim()
        if (text) this.emit({ type: 'transcript', text, final: true })
      }
      return
    }
    let partial = ''
    for (const token of (Array.isArray(data.tokens) ? data.tokens : []) as { text: string; is_final: boolean }[]) {
      if (token.text === '<end>' || token.text === '<fin>') {
        if (token.is_final) {
          if (this.finalText.trim()) this.emit({ type: 'transcript', text: this.finalText.trim(), final: true })
          this.finalText = ''; partial = ''; this.speaking = false
        }
        continue
      }
      if (!token.text || /^<[^>]+>$/.test(token.text)) continue
      if (!this.speaking) { this.speaking = true; this.emit({ type: 'speech' }) }
      if (token.is_final) this.finalText += token.text
      else partial += token.text
    }
    if (this.finalText.length + partial.length > 10_000) throw new Error('Speech segment is too long; pause between turns')
    if (this.finalText || partial) this.emit({ type: 'transcript', text: this.finalText + partial, final: false })
  }
}

export async function transcribeVoice(settings: VoiceSettings, names: string[], emit: (event: VoiceEvent) => void, signal: AbortSignal) {
  const key = settings.asrProvider === 'soniox' ? settings.sonioxApiKey : settings.qwenApiKey
  if (!key) throw new Error('请先配置语音识别 API Key / Configure the ASR API key first')
  if (signal.aborted) return
  if (sessions.size >= 4) throw new Error('Too many active voice calls; end another call first')
  const qwen = settings.asrProvider === 'qwen'
  const url = new URL(qwen ? settings.qwenUrl : 'wss://stt-rt.soniox.com/transcribe-websocket')
  if (qwen) url.searchParams.set('model', settings.qwenModel)
  const socket = new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 1_000_000, headers: qwen ? { Authorization: `Bearer ${key}` } : undefined })
  const id = randomUUID()
  await new Promise<void>((resolve, reject) => {
    let ended = false; let ready = false
    const close = (error?: Error) => {
      if (ended) return
      ended = true; sessions.delete(id); clearTimeout(startup); clearInterval(watchdog)
      signal.removeEventListener('abort', onAbort)
      socket.terminate()
      if (error && !signal.aborted) reject(error); else resolve()
    }
    const onAbort = () => close()
    const startup = setTimeout(() => close(new Error('ASR connection timed out')), 15_000)
    const started = Date.now()
    const watchdog = setInterval(() => {
      if (Date.now() - session.touched > 20_000 || Date.now() - started > 60 * 60_000) close(new Error('Voice connection expired; start a new call'))
    }, 5000)
    const session: AsrSession = { socket, provider: settings.asrProvider, nextSequence: 0, touched: Date.now(), close }
    sessions.set(id, session)
    const markReady = () => { if (!ready && !ended) { ready = true; clearTimeout(startup); emit({ type: 'ready', sessionId: id }) } }
    const transcript = new AsrTranscript(settings.asrProvider, emit)
    signal.addEventListener('abort', onAbort, { once: true })
    socket.on('open', () => {
      if (qwen) socket.send(JSON.stringify({ event_id: randomUUID(), type: 'session.update', session: {
        input_audio_format: 'pcm', sample_rate: 16000,
        input_audio_transcription: settings.language === 'auto' ? {} : { language: settings.language },
        turn_detection: { type: 'server_vad', threshold: 0.0, silence_duration_ms: settings.silenceMs },
      } }))
      else {
        socket.send(JSON.stringify({ api_key: key, model: settings.sonioxModel, audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
          ...(settings.language === 'auto' ? {} : { language_hints: [settings.language] }),
          context: { terms: names }, enable_endpoint_detection: true, endpoint_latency_adjustment_level: 2,
          endpoint_sensitivity: 0.3, max_endpoint_delay_ms: Math.max(500, settings.silenceMs),
        }))
        markReady()
      }
    })
    socket.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.error_code || data.type === 'error' || data.type === 'conversation.item.input_audio_transcription.failed') {
          close(new Error(`${qwen ? 'Qwen' : 'Soniox'} rejected the voice stream; check API key, model and quota`)); return
        }
        if (data.type === 'session.updated') markReady()
        transcript.accept(data)
      } catch { close(new Error('ASR returned an invalid response')) }
    })
    socket.on('error', () => close(new Error('Unable to connect to ASR; check network, endpoint and API key')))
    socket.on('close', () => close(new Error('ASR disconnected; start a new call')))
    if (signal.aborted) close()
  })
}

export function pushVoiceAudio(id: string, audio: Uint8Array, sequence: number) {
  const session = sessions.get(id)
  if (!session || session.socket.readyState !== WebSocket.OPEN) return 'expired'
  if (sequence !== session.nextSequence) return 'sequence'
  if (session.socket.bufferedAmount > 128_000) return 'slow'
  session.nextSequence++; session.touched = Date.now()
  if (session.provider === 'qwen') session.socket.send(JSON.stringify({ event_id: randomUUID(), type: 'input_audio_buffer.append', audio: Buffer.from(audio).toString('base64') }))
  else session.socket.send(audio)
  return 'ok'
}

export function closeVoiceAsr(id: string) { sessions.get(id)?.close() }
