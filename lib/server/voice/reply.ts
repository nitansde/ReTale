import type { VoiceEvent, VoiceSettings } from '@/lib/voice-chat'
import { speakableText, splitVoicePhrases, usesDialogueQuotes, type SpeechState } from '@/lib/voice-chat'
import type { VoiceTrace } from '@/lib/server/voice/debug'

async function requestFishPhrase(text: string, settings: VoiceSettings, signal: AbortSignal) {
  const started = Date.now()
  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    headers: { Authorization: `Bearer ${settings.fishApiKey}`, 'Content-Type': 'application/json', model: settings.fishModel },
    body: JSON.stringify({ text, reference_id: settings.voiceId, format: 'pcm', sample_rate: 24000, latency: 'balanced' }),
  })
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).trim().slice(0, 200)
    throw new Error(`Fish Audio 请求失败 (${response.status})${detail ? `: ${detail}` : ''}；请检查密钥、音色和额度 / Check key, voice and quota`)
  }
  // Return the Response, not just its body: undici cancels an unread body once
  // its Response is garbage collected, and the next sentence waits unread.
  return { response, headersMs: Date.now() - started, fishTraceId: response.headers.get('x-fish-trace-id') }
}

async function emitFishAudio(body: ReadableStream<Uint8Array>, segment: number, emit: (event: VoiceEvent) => void, signal: AbortSignal) {
  const reader = body.getReader()
  let bytes = 0; let chunks = 0; let carry: Uint8Array | undefined
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      signal.throwIfAborted()
      bytes += value.length; chunks++
      if (bytes > 24_000 * 2 * 120) throw new Error('Voice audio exceeded two minutes')
      // Emit whole PCM16 samples only; Fish chunk boundaries can split one.
      const data = carry ? Buffer.concat([carry, value]) : value
      const even = data.length - (data.length % 2)
      carry = even < data.length ? data.subarray(even) : undefined
      // Keep framed messages small, even if an upstream proxy coalesces packets.
      for (let offset = 0; offset < even; offset += 16_384) {
        emit({ type: 'audio', segment, sampleRate: 24000, audio: Buffer.from(data.subarray(offset, Math.min(offset + 16_384, even))).toString('base64') })
      }
    }
    // Fish answers 200 with no audio when nothing in the text is speakable:
    // skip that sentence (never marked heard) instead of failing the turn.
    if (bytes > 1) emit({ type: 'segment-end', segment })
    return { bytes, chunks }
  } finally { await reader.cancel().catch(() => undefined) }
}

/** Read a phrase as soon as it exists; stream its audio before the rest of the
 * model reply finishes. Each phrase's TTS request starts immediately, so the
 * next sentence is ready when the current one ends, but audio is emitted in
 * order. Sentence boundaries let the browser record only speech that actually
 * finished playing when the user interrupts. */
export async function speakModelStream(stream: ReadableStream<Uint8Array>, settings: VoiceSettings, emit: (event: VoiceEvent) => void, signal: AbortSignal, trace: VoiceTrace = () => {}) {
  const reader = stream.getReader(); const decoder = new TextDecoder()
  const failed = new AbortController(); const ttsSignal = AbortSignal.any([signal, failed.signal])
  ttsSignal.addEventListener('abort', () => { void reader.cancel().catch(() => undefined) }, { once: true })
  let rest = ''; let raw = ''
  const description: SpeechState = { depth: 0, star: false, quote: 0, quoted: false }
  const spoken: Promise<void>[] = []
  const last = () => spoken.at(-1) ?? Promise.resolve()
  try {
    while (true) {
      ttsSignal.throwIfAborted()
      const { value, done } = await reader.read()
      ttsSignal.throwIfAborted()
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true })
      raw += chunk
      if (raw.length > 4000) throw new Error('Voice reply is too long; reduce model output length')
      const split = splitVoicePhrases(rest + chunk, done)
      rest = split.rest
      // Judged on the whole reply so far: narration before the first quote is skipped too.
      description.quoted ||= usesDialogueQuotes(raw)
      for (const text of split.phrases) {
        const id = spoken.length
        const speech = speakableText(text, description)
        const silent = !/[\p{L}\p{N}]/u.test(speech)
        trace('phrase', { segment: id, text, ...(speech === text ? {} : { speech }) })
        let requestedAt = 0
        // At most two TTS requests in flight: the playing sentence and the next.
        const audio = silent ? null : (spoken[id - 2] ?? Promise.resolve()).then(() => { requestedAt = Date.now(); return requestFishPhrase(speech, settings, ttsSignal) })
        audio?.catch(() => undefined) // Surfaced, in order, through `spoken`.
        const step = last().then(async () => {
          emit({ type: 'text', text, segment: id, ...(silent ? { silent } : {}) })
          if (!audio) return // Description only: shown and saved, never voiced.
          const { response, headersMs, fishTraceId } = await audio
          const result = await emitFishAudio(response.body!, id, emit, ttsSignal)
          trace('tts', { segment: id, text: speech, headersMs, totalMs: Date.now() - requestedAt, fishTraceId, ...result, ...(result.bytes < 2 ? { skipped: 'no audio' } : result.bytes % 2 ? { droppedOddByte: true } : {}) })
        })
        step.catch((error: unknown) => { trace('tts-error', { segment: id, text, message: error instanceof Error ? error.message : String(error), aborted: signal.aborted }); failed.abort() })
        spoken.push(step)
      }
      if (done) break
    }
    if (!spoken.length) throw new Error('模型未返回可朗读内容 / Model returned no speech')
    await last()
    emit({ type: 'done' })
  } catch (error) {
    // A failed sentence (or interruption) aborts the read; report the TTS error.
    if (ttsSignal.aborted) await last()
    throw error
  } finally {
    trace('model-text', { text: raw, phrases: spoken.length })
    failed.abort(); await reader.cancel().catch(() => undefined)
  }
}
