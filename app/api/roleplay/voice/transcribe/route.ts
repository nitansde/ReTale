import { apiRequestErrorResponse, jsonError, readJsonObject } from '@/lib/server/api-route'
import { assertVoiceOrigin, loadVoiceSettings } from '@/lib/server/voice/settings'
import { transcribeVoice } from '@/lib/server/voice/asr'
import { voiceEventStream, VOICE_STREAM_HEADERS } from '@/lib/server/voice/event-stream'
import { voiceTracer } from '@/lib/server/voice/debug'

export const runtime = 'nodejs'
export const maxDuration = 3600
export async function POST(request: Request) {
  try {
    assertVoiceOrigin(request)
    const body = await readJsonObject(request, 4000)
    const names = Array.isArray(body.names) ? body.names.filter((name): name is string => typeof name === 'string' && name.length <= 80).slice(0, 20) : []
    const settings = loadVoiceSettings()
    const trace = voiceTracer(body.callId)
    trace('asr-start', { provider: settings.asrProvider, model: settings.asrProvider === 'qwen' ? settings.qwenModel : settings.sonioxModel, language: settings.language, silenceMs: settings.silenceMs })
    return new Response(voiceEventStream(request.signal, (emit, signal) => transcribeVoice(settings, names, emit, signal), trace), { headers: VOICE_STREAM_HEADERS })
  } catch (error) { return apiRequestErrorResponse(error) ?? jsonError('Unable to start voice recognition', 500) }
}
