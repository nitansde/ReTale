import { z } from 'zod'
import { DEFAULT_VOICE_SETTINGS, type PublicVoiceSettings, type VoiceSettings } from '@/lib/voice-chat'
import { findAppSettings, upsertAppSettings } from '@/lib/server/persistence'
import { ApiRequestError } from '@/lib/server/api-route'

const KEY = 'VOICE_SETTINGS_V1'
const schema = z.object({
  asrProvider: z.enum(['soniox', 'qwen']),
  sonioxApiKey: z.string().trim().max(2000), sonioxModel: z.string().trim().min(1).max(100),
  qwenApiKey: z.string().trim().max(2000), qwenModel: z.string().trim().min(1).max(100),
  qwenUrl: z.string().url().max(1000).refine((value) => {
    const url = new URL(value)
    return url.protocol === 'wss:' && !url.username && !url.password
      && (url.hostname === 'dashscope.aliyuncs.com' || url.hostname === 'dashscope-intl.aliyuncs.com' || url.hostname.endsWith('.maas.aliyuncs.com'))
  }, 'Use an official Alibaba Cloud WSS endpoint'),
  fishApiKey: z.string().trim().max(2000), fishModel: z.string().trim().min(1).max(100),
  voiceId: z.string().trim().max(200), language: z.enum(['zh', 'en', 'auto']),
  silenceMs: z.number().int().min(300).max(2000), thinking: z.enum(['default', 'off', 'low']),
})

export function loadVoiceSettings(): VoiceSettings {
  const stored = findAppSettings([KEY])[0]?.value
  const fallback = {
    ...DEFAULT_VOICE_SETTINGS,
    sonioxApiKey: process.env.SONIOX_API_KEY || '', qwenApiKey: process.env.DASHSCOPE_API_KEY || '',
    fishApiKey: process.env.FISH_API_KEY || '', voiceId: process.env.FISH_VOICE_ID || '',
  }
  if (!stored) return fallback
  try { return schema.parse({ ...fallback, ...JSON.parse(stored) }) } catch { return fallback }
}

export function publicVoiceSettings(settings: VoiceSettings): PublicVoiceSettings {
  const { sonioxApiKey, qwenApiKey, fishApiKey, ...rest } = settings
  return { ...rest, sonioxConfigured: Boolean(sonioxApiKey), qwenConfigured: Boolean(qwenApiKey), fishConfigured: Boolean(fishApiKey) }
}

export async function saveVoiceSettings(body: Record<string, unknown>) {
  const current = loadVoiceSettings()
  const merged = { ...current, ...body }
  for (const key of ['sonioxApiKey', 'qwenApiKey', 'fishApiKey'] as const) {
    // Empty inputs preserve server-held secrets. Explicit clear is separate.
    merged[key] = body[`clear_${key}`] === true ? '' : typeof body[key] === 'string' && body[key].trim() ? body[key] : current[key]
  }
  const parsed = schema.safeParse(merged)
  if (!parsed.success) throw new ApiRequestError(400, parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  await upsertAppSettings([[KEY, JSON.stringify(parsed.data)]])
  return publicVoiceSettings(parsed.data)
}

export function assertVoiceOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin && new URL(origin).host !== request.headers.get('host'))) {
    throw new ApiRequestError(403, 'Cross-origin voice requests are not allowed')
  }
}
