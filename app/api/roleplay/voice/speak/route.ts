import { apiRequestErrorResponse, jsonError, readJsonObject } from '@/lib/server/api-route'
import { assertVoiceOrigin, loadVoiceSettings } from '@/lib/server/voice/settings'
import { requestFishPhrase } from '@/lib/server/voice/reply'
import { speakableText, usesDialogueQuotes } from '@/lib/voice-chat'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Read an existing reply; never generate another model response or require ASR. */
export async function POST(request: Request) {
  try {
    assertVoiceOrigin(request)
    const body = await readJsonObject(request, 100_000)
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 16000) return jsonError('Invalid speech text', 400)
    const settings = loadVoiceSettings()
    if (!settings.fishApiKey || !settings.voiceId) return jsonError('请先配置 Fish API Key 和音色 ID / Configure Fish API key and voice ID', 400)
    const text = speakableText(body.text, { depth: 0, star: false, quote: 0, quoted: usesDialogueQuotes(body.text) })
    if (!/[\p{L}\p{N}]/u.test(text)) return jsonError('没有可朗读的台词 / No dialogue to read', 400)
    const { response } = await requestFishPhrase(text, settings, request.signal, 'mp3')
    return new Response(response.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
  } catch (error) {
    return apiRequestErrorResponse(error) ?? jsonError('语音播放失败，请检查 Fish 配置及额度 / Speech failed; check Fish settings and quota', 502)
  }
}
