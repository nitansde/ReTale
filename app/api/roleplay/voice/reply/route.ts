import { apiRequestErrorResponse, jsonError, readJsonObject, MAX_GENERATION_JSON_BODY_BYTES } from '@/lib/server/api-route'
import { createNovelDatabaseAccess, runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { findRoleplaySessionById } from '@/lib/server/roleplay-store'
import { prepareGenerationPrompt } from '@/lib/server/generation-prompt'
import { streamRewriteWithOpenAICompatible } from '@/lib/server/openai-compatible'
import { streamRewriteWithOllama } from '@/lib/server/ollama-local'
import { assertVoiceOrigin, loadVoiceSettings } from '@/lib/server/voice/settings'
import { voiceEventStream, VOICE_STREAM_HEADERS } from '@/lib/server/voice/event-stream'
import { speakModelStream } from '@/lib/server/voice/reply'
import { voiceTracer } from '@/lib/server/voice/debug'
import { parseRoleplayTurn, readGeneratedRoleplayScript } from '@/lib/roleplay-script'

export const runtime = 'nodejs'
export const maxDuration = 180
export async function POST(request: Request) {
  try {
    assertVoiceOrigin(request)
    const body = await readJsonObject(request, MAX_GENERATION_JSON_BODY_BYTES)
    const turn = parseRoleplayTurn(body.roleplayTurn)
    if (!turn || typeof body.novelId !== 'string' || typeof body.roleplaySessionId !== 'string') return jsonError('Invalid voice roleplay turn', 400)
    const db = createNovelDatabaseAccess(body.novelId)
    const session = findRoleplaySessionById(body.roleplaySessionId, db)
    if (!session || session.novelId !== body.novelId || session.branchId !== body.branchId) return jsonError('Roleplay session not found', 404)
    const settings = loadVoiceSettings()
    if (!settings.fishApiKey || !settings.voiceId) return jsonError('请先配置 Fish API Key 和音色 ID / Configure Fish API key and voice ID', 400)
    const trace = voiceTracer(body.voiceCallId)
    const started = Date.now()
    trace('reply-start', { dialogue: turn.dialogue, leafMessageId: body.roleplayLeafMessageId, history: Array.isArray(body.roleplayMessages) ? body.roleplayMessages.length : 0, contextSnapshot: Boolean(body.contextSnapshotId), fishModel: settings.fishModel })
    return new Response(voiceEventStream(request.signal, async (emit, signal) => {
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
      await runWithNovelDatabaseAccess(body.novelId as string, async () => {
        const { runtime: prepared } = await prepareGenerationPrompt({ ...body, operationType: 'roleplay', stream: true })
        boundedSignal.throwIfAborted()
        const provider = prepared.resolvedRuntime.providerRuntime
        trace('prompt-ready', { ms: Date.now() - started, provider: provider.provider, model: provider.config.model, systemChars: prepared.systemPrompt.length, userChars: prepared.userPrompt.length })
        // Same preset request options as text replies; only cap max_tokens when the preset allows more.
        const requestOptions = provider.provider === 'openai-compatible'
          ? { ...provider.request, max_tokens: Math.min(provider.request.max_tokens ?? 2048, 2048) }
          : provider.request.options
        const input = { systemPrompt: prepared.systemPrompt, userPrompt: prepared.userPrompt, signal: boundedSignal, temperature: body.tone === 'keep' ? 0.7 : 0.9, requestOptions }
        const deepseek = provider.provider === 'openai-compatible' && /deepseek/i.test(provider.config.model ?? '')
        const result = provider.provider === 'openai-compatible'
          ? await streamRewriteWithOpenAICompatible({ ...input, ...(deepseek && settings.thinking !== 'default' ? {
              thinking: { type: settings.thinking === 'off' ? 'disabled' as const : 'enabled' as const },
              ...(settings.thinking === 'low' ? { reasoningEffort: 'low' as const } : {}),
            } : {}) }, provider.config)
          : await streamRewriteWithOllama(input, provider.config)
        if (!result.enabled || !result.stream) throw new Error(result.error || '请先配置角色扮演的 AI 模型 / Configure the roleplay model first')
        // Voice is a dialogue-only turn: same output regex and JSON as text replies, speak the counterpart text.
        // ponytail: buffers the short reply before TTS; stream-parse the JSON text field if first-audio latency matters.
        const content = prepared.applyOutputRuntime(await new Response(result.stream).text()).value
        const text = readGeneratedRoleplayScript(content, turn)?.blocks[0]?.text ?? content
        await speakModelStream(new Response(text).body!, settings, emit, boundedSignal, trace)
        trace('reply-done', { ms: Date.now() - started })
      })
    }, trace), { headers: VOICE_STREAM_HEADERS })
  } catch (error) { return apiRequestErrorResponse(error) ?? jsonError('Unable to start voice reply', 500) }
}
