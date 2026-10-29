import fs from 'node:fs'
import path from 'node:path'

export type VoiceTrace = (event: string, data?: Record<string, unknown>) => void

/** Append-only JSONL trace of voice calls, one file per day under
 * logs/voice-debug. Server and phone events share the call id, so a failed
 * call reads top to bottom. Audio is summarized (bytes), never stored. */
export function traceVoice(call: string, from: 'server' | 'phone', event: string, data: Record<string, unknown> = {}) {
  const at = new Date().toISOString()
  const directory = path.join(process.cwd(), 'logs', 'voice-debug')
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.appendFileSync(path.join(directory, `${at.slice(0, 10)}.jsonl`), `${JSON.stringify({ at, call, from, event, ...data })}\n`, { mode: 0o600 })
  } catch { /* Tracing must never break a call. */ }
}

export function voiceTracer(call: unknown): VoiceTrace {
  const id = typeof call === 'string' && call ? call.slice(0, 64) : 'unknown'
  return (event, data) => traceVoice(id, 'server', event, data)
}
