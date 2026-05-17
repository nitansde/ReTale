import { NextResponse } from 'next/server'
import { buildGenerationContext } from '@/lib/server/context-builder'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { applyPresetCompatCreativeRuntime } from '@/lib/preset-compat/apply-runtime'
import { transformBufferedTextStream } from '@/lib/preset-compat/stream-buffer'
import {
  buildFallbackRewriteStream,
  generateRewriteWithOpenAICompatible,
  streamRewriteWithOpenAICompatible,
} from '@/lib/server/openai-compatible'
import { generateRewriteWithOllama, streamRewriteWithOllama } from '@/lib/server/ollama-local'

function fallbackCandidates(sourceText: string, mode: string, tone: string, prompt: string) {
  const base = sourceText.trim()
  return [
    `${base} 空气里的湿冷像一把迟迟没有落下的刀。`,
    `${base} 她没有再让自己停在原地，几乎在下一秒就被逼着向前。`,
    `${base} 她决定偏离更安全的做法，而这个念头本身就像命运在推她一把。`,
  ].map((text, index) => ({
    title: `候选 ${String.fromCharCode(65 + index)}`,
    summary: `模式：${mode} · 风格：${tone} · ${prompt || '默认提示词'}`,
    content: text,
  }))
}

function buildFallbackText(sourceText: string, mode: string, tone: string, prompt: string) {
  return fallbackCandidates(sourceText, mode, tone, prompt)[0]?.content ?? sourceText
}

function buildSystemPrompt() {
  return [
    '你是 ChatBook 的小说扩写/魔改写作模型。',
    '你必须严格遵守给定的小说世界状态、人物关系、事件线和设定。',
    '你只能使用上下文中提供的截至当前章节的信息。',
    '不要引入未来章节事实。',
    '不要擅自改变已确认的人物状态、阵营、关系和世界规则。',
    '如果用户要求魔改，可以改变当前片段及其后续走向，但不得和当前章节之前的事实矛盾。',
    '保持原文文风、叙事视角、人称、节奏和人物口吻。',
    '优先输出可直接替换或插入到小说中的正文，不要解释。',
  ].join('\n')
}

function normalizeOperationType(value: unknown) {
  const operationType = String(value ?? 'expand').trim()
  if (operationType === 'expand' || operationType === 'rewrite' || operationType === 'roleplay' || operationType === 'polish' || operationType === 'continue') {
    return operationType
  }
  return 'expand'
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)))
}

function buildUserPrompt(params: {
  operationType: string
  userInstruction: string
  chapterNo?: number
  selectedLineStart?: number | null
  selectedLineEnd?: number | null
  selectedText: string
  assembledContext: string
}) {
  return [
    '# 任务',
    `操作类型：${params.operationType}`,
    `用户要求：${params.userInstruction || '按当前模式生成。'}`,
    '',
    '# 当前章节',
    params.chapterNo ? `当前章节：第 ${params.chapterNo} 章` : '当前章节：未知',
    params.selectedLineStart && params.selectedLineEnd
      ? `选中行：${params.selectedLineStart} - ${params.selectedLineEnd}`
      : '选中行：未知',
    '',
    '# 选中文本',
    params.selectedText,
    '',
    params.assembledContext,
  ].join('\n')
}

export async function POST(request: Request) {
  const body = await request.json()
  const rewriteSettings = loadStoredAISettings().rewrite
  const rewriteProvider = rewriteSettings.provider
  const userInstruction = String(body.userInstruction ?? body.prompt ?? '')

  const sourceText = String(body.sourceText ?? '')
  const selectedText = String(body.selectedText ?? body.sourceText ?? '')
  const operationType = normalizeOperationType(body.operationType ?? body.mode)
  const disabledBlockIds = Array.isArray(body.disabledBlockIds) ? body.disabledBlockIds.map((item: unknown) => String(item)) : []
  const excludedGraphEdgeIds = normalizeStringArray(body.excludedGraphEdgeIds)
  const excludedEvidenceIds = normalizeStringArray(body.excludedEvidenceIds)
  const context = body.novelId && body.chapterId
    ? await buildGenerationContext({
        novelId: String(body.novelId),
        branchId: body.branchId ? String(body.branchId) : undefined,
        chapterId: String(body.chapterId),
        selectedText,
        operationType,
        userInstruction,
        excludedGraphEdgeIds,
        excludedEvidenceIds,
        whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
        futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
      })
    : null
  const assembledContext = context
    ? context.promptBlocks
        .filter((block) => !disabledBlockIds.includes(block.id))
        .map((block) => block.content)
        .join('\n\n')
    : String(body.prompt ?? '')
  const baseSystemPrompt = buildSystemPrompt()
  const baseUserPrompt = buildUserPrompt({
    operationType,
    userInstruction,
    chapterNo: context?.chapterNo,
    selectedLineStart: context?.selectedLineStart,
    selectedLineEnd: context?.selectedLineEnd,
    selectedText,
    assembledContext,
  })
  const runtime = applyPresetCompatCreativeRuntime({
    surfaceId: operationType,
    providerDefaults: {
      provider: rewriteProvider,
      openAICompatible: {
        config: rewriteSettings.openAICompatible,
        request: { temperature: body.tone === 'keep' ? 0.7 : 0.9 },
      },
      ollama: {
        config: rewriteSettings.ollama,
        request: { temperature: body.tone === 'keep' ? 0.7 : 0.9 },
      },
    },
    systemPrompt: baseSystemPrompt,
    userPrompt: baseUserPrompt,
    promptRuleRuntimeContext: body.presetCompatRuntimeContext && typeof body.presetCompatRuntimeContext === 'object'
      ? body.presetCompatRuntimeContext as Record<string, unknown>
      : undefined,
  })

  if (body.stream) {
    const promptPayload = {
      systemPrompt: runtime.systemPrompt,
      userPrompt: runtime.userPrompt,
      temperature: body.tone === 'keep' ? 0.7 : 0.9,
      requestOptions: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
        ? runtime.resolvedRuntime.providerRuntime.request
        : runtime.resolvedRuntime.providerRuntime.request.options,
    }
    const streamResult = runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
      ? await streamRewriteWithOpenAICompatible(promptPayload, runtime.resolvedRuntime.providerRuntime.config)
      : await streamRewriteWithOllama(promptPayload, runtime.resolvedRuntime.providerRuntime.config)

    if (streamResult.enabled && streamResult.stream) {
      const responseStream = runtime.hasActiveOutputRegex
        ? await transformBufferedTextStream(streamResult.stream, (value) => runtime.applyOutputRuntime(value).value)
        : streamResult.stream

      return new Response(responseStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      })
    }

    const fallback = buildFallbackText(sourceText || selectedText, String(body.mode ?? ''), String(body.tone ?? ''), String(body.prompt ?? ''))
    return new Response(streamResult.error ? buildFallbackRewriteStream(`${fallback}\n`) : buildFallbackRewriteStream(fallback), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    })
  }

  const rewriteInput = {
    sourceText,
    mode: body.mode,
    tone: body.tone,
    scope: body.scope,
    prompt: context
      ? [String(body.prompt ?? ''), assembledContext].filter(Boolean).join('\n\n')
      : body.prompt,
    keepCanon: Boolean(body.keepCanon),
    autoContinue: Boolean(body.autoContinue),
    thoughtLevel: body.thoughtLevel,
    systemPrompt: runtime.systemPrompt,
    userPrompt: runtime.userPrompt,
    requestOptions: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
      ? runtime.resolvedRuntime.providerRuntime.request
      : runtime.resolvedRuntime.providerRuntime.request.options,
  }
  const result = runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
    ? await generateRewriteWithOpenAICompatible(rewriteInput, runtime.resolvedRuntime.providerRuntime.config)
    : await generateRewriteWithOllama(rewriteInput, runtime.resolvedRuntime.providerRuntime.config)

  if (result.enabled && result.content?.length) {
    const candidates = result.content.map((content) => runtime.applyOutputRuntime(content).value)

    return NextResponse.json({
      provider: runtime.resolvedRuntime.providerRuntime.provider,
      metadata: runtime.metadata,
      candidates: candidates.map((content, index) => ({
        title: `候选 ${String.fromCharCode(65 + index)}`,
        summary: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible' ? '来自 OpenAI-compatible API' : '来自 Ollama 本地模型',
        content,
      })),
    })
  }

  return NextResponse.json({
    provider: result.enabled ? 'fallback-after-error' : 'fallback-no-config',
    metadata: runtime.metadata,
    error: result.error,
    candidates: fallbackCandidates(body.sourceText, body.mode, body.tone, body.prompt),
  })
}
