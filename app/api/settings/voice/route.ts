import { apiRequestErrorResponse, noStoreJson, jsonError, readJsonObject } from '@/lib/server/api-route'
import { assertVoiceOrigin, loadVoiceSettings, publicVoiceSettings, saveVoiceSettings } from '@/lib/server/voice/settings'

export async function GET() { return noStoreJson(publicVoiceSettings(loadVoiceSettings())) }
export async function POST(request: Request) {
  try {
    assertVoiceOrigin(request)
    return noStoreJson(await saveVoiceSettings(await readJsonObject(request, 16_000)))
  } catch (error) { return apiRequestErrorResponse(error) ?? jsonError('Unable to save voice settings', 500) }
}
