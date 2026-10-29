import { apiRequestErrorResponse, jsonError, noStoreJson, readJsonObject } from '@/lib/server/api-route'
import { assertVoiceOrigin } from '@/lib/server/voice/settings'
import { traceVoice } from '@/lib/server/voice/debug'

export const runtime = 'nodejs'
// Phone-side voice events (states, interrupts, playback, errors) for the shared trace.
export async function POST(request: Request) {
  try {
    assertVoiceOrigin(request)
    const { call, event, ...data } = await readJsonObject(request, 8000)
    if (typeof call !== 'string' || typeof event !== 'string') return jsonError('Invalid voice trace', 400)
    traceVoice(call.slice(0, 64), 'phone', event.slice(0, 64), data)
    return noStoreJson({ ok: true })
  } catch (error) { return apiRequestErrorResponse(error) ?? jsonError('Unable to record voice trace', 500) }
}
