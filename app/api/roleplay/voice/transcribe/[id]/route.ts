import { apiRequestErrorResponse, createByteLimitedRequest, jsonError, noStoreJson } from '@/lib/server/api-route'
import { assertVoiceOrigin } from '@/lib/server/voice/settings'
import { closeVoiceAsr, pushVoiceAudio } from '@/lib/server/voice/asr'

export const runtime = 'nodejs'
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertVoiceOrigin(request)
    const { id } = await ctx.params
    const sequence = Number(request.headers.get('x-audio-sequence') ?? '-1')
    if (!Number.isSafeInteger(sequence) || sequence < 0) return jsonError('Invalid audio sequence', 400)
    const data = new Uint8Array(await createByteLimitedRequest(request, 32_000, 'Audio packet too large').arrayBuffer())
    if (!data.length || data.length % 2) return jsonError('Expected PCM16 audio', 400)
    const result = pushVoiceAudio(id, data, sequence)
    return result === 'ok' ? noStoreJson({ ok: true }) : jsonError(`Voice audio ${result}`, result === 'expired' ? 410 : 409)
  } catch (error) { return apiRequestErrorResponse(error) ?? jsonError('Unable to send voice audio', 500) }
}
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try { assertVoiceOrigin(request); closeVoiceAsr((await ctx.params).id); return noStoreJson({ ok: true }) }
  catch (error) { return apiRequestErrorResponse(error) ?? jsonError('Unable to close voice recognition', 500) }
}
