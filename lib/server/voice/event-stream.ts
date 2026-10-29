import type { VoiceEvent } from '@/lib/voice-chat'
import type { VoiceTrace } from '@/lib/server/voice/debug'

export const VOICE_STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no',
}

export function voiceEventStream(signal: AbortSignal, run: (emit: (event: VoiceEvent) => void, signal: AbortSignal) => Promise<void>, trace: VoiceTrace = () => {}) {
  const abort = new AbortController()
  const onAbort = () => abort.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) abort.abort()
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const emit = (event: VoiceEvent) => {
        if (closed || abort.signal.aborted) return
        // Bound memory if the browser stops consuming audio/transcripts.
        if ((controller.desiredSize ?? 0) < -2_000_000) { trace('stream-overflow', { queuedBytes: -(controller.desiredSize ?? 0) }); abort.abort(); return }
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      const heartbeat = setInterval(() => emit({ type: 'ping' }), 10_000)
      try { await run(emit, abort.signal) }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Voice service failed'
        // The phone only shows this briefly; keep it in the server log for diagnosis.
        if (!abort.signal.aborted) console.warn(`[voice] ${message}`)
        trace('stream-error', { message, aborted: abort.signal.aborted })
        emit({ type: 'error', error: message })
      }
      finally {
        clearInterval(heartbeat); signal.removeEventListener('abort', onAbort)
        closed = true
        try { controller.close() } catch { /* Reader cancelled. */ }
      }
    },
    cancel() { trace('stream-cancelled'); abort.abort() },
  }, { highWaterMark: 256_000, size: (chunk) => chunk.byteLength })
}
