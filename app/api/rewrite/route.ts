import { NextResponse } from 'next/server'
import { buildGenerationContext } from '@/lib/server/context-builder'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { applyPresetCompatCreativeRuntime } from '@/lib/preset-compat/apply-runtime'
import {
  resolveCreativeRoutePresetCompatMetadata,
  serializePresetCompatResponseMetadata,
} from '@/lib/preset-compat/runtime-integration'
import { bufferAndTransformTextStream } from '@/lib/preset-compat/stream-buffer'
import {
  buildFallbackRewriteStream,
  generateRewriteWithOpenAICompatible,
  streamRewriteWithOpenAICompatible,
} from '@/lib/server/openai-compatible'
import { writeLlmDebugLog } from '@/lib/server/llm-debug-log'
import { generateRewriteWithOllama, streamRewriteWithOllama } from '@/lib/server/ollama-local'
import type { PresetCompatPromptRuleRuntimeContext, PresetCompatRuntimeContextBlock } from '@/lib/preset-compat/types'
import type { GenerationContextBlock } from '@/lib/server/context-builder'
import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'

const INVALID_OPERATION_TYPE_ERROR = `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}`

function mapSurfaceContextBlocks(promptBlocks: readonly GenerationContextBlock[] | null): PresetCompatRuntimeContextBlock[] {
  if (!promptBlocks) {
    return []
  }

  return promptBlocks.flatMap((block) => {
    const abstraction = block.id === 'worldbuilding'
      ? 'world_info'
      : block.id === 'characters'
        ? 'personality'
        : block.id === 'current-summary'
          || block.id === 'recent-summaries'
          || block.id === 'chapter-state'
          || block.id === 'authored-branch-context'
          || block.id === 'graph-context'
          || block.id === 'facts'
          || block.id === 'events'
            ? 'scenario'
            : null

    if (!abstraction) {
      return []
    }

    return [{
      id: block.id,
      label: block.label,
      content: block.content,
      abstraction,
    } satisfies PresetCompatRuntimeContextBlock]
  })
}

function normalizePresetCompatRuntimeContext(
  body: Record<string, unknown>,
  operationType: ProductSurfaceId,
  promptBlocks: readonly GenerationContextBlock[] | null
): PresetCompatPromptRuleRuntimeContext {
  const rawContext = body.presetCompatRuntimeContext
  const runtimeContext = rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
    ? rawContext as Record<string, unknown>
    : {}
  const sessionPhase = typeof runtimeContext.sessionPhase === 'string'
    ? runtimeContext.sessionPhase
    : null
  const namedTranscript = runtimeContext.namedTranscript && typeof runtimeContext.namedTranscript === 'object' && !Array.isArray(runtimeContext.namedTranscript)
    ? runtimeContext.namedTranscript as Record<string, unknown>
    : null
  const explicitProtagonistName = typeof runtimeContext.protagonistName === 'string'
    ? runtimeContext.protagonistName.trim()
    : typeof runtimeContext.macroUserName === 'string'
      ? runtimeContext.macroUserName.trim()
      : ''

  return {
    sessionPhase: sessionPhase === 'new_chat'
      || sessionPhase === 'new_group_chat'
      || sessionPhase === 'new_example_chat'
      || sessionPhase === 'continue'
      ? sessionPhase
      : null,
    hasGroupContext: runtimeContext.hasGroupContext === true,
    hasExampleContext: runtimeContext.hasExampleContext === true,
    hasImpersonationContext: runtimeContext.hasImpersonationContext === true,
    supportsVirtualDepth: false,
    surfaceContextBlocks: mapSurfaceContextBlocks(promptBlocks),
    namedTranscript: namedTranscript
      ? {
          kind: namedTranscript.kind === 'roleplay' ? 'roleplay' : 'chat',
          userName: typeof namedTranscript.userName === 'string' ? namedTranscript.userName : null,
          assistantName: typeof namedTranscript.assistantName === 'string' ? namedTranscript.assistantName : null,
        }
      : null,
    protagonistName: explicitProtagonistName || inferProtagonistNameFromPromptBlocks(promptBlocks),
  }
}

function inferProtagonistNameFromPromptBlocks(promptBlocks: readonly GenerationContextBlock[] | null) {
  const charactersBlock = promptBlocks?.find((block) => block.id === 'characters')
  if (!charactersBlock) return null

  const match = charactersBlock.content.match(/^\s*-\s*([^｜|\n]+)[｜|]/m)
  const name = match?.[1]?.trim() ?? ''
  if (!name || name.startsWith('未命中')) return null
  return name
}

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

function parseOperationType(value: unknown): ProductSurfaceId | null {
  const operationType = String(value ?? '').trim()
  return PRODUCT_SURFACE_IDS.includes(operationType as ProductSurfaceId)
    ? operationType as ProductSurfaceId
    : null
}

function resolveRewriteRouteSurfaceId(operationType: ProductSurfaceId): ProductSurfaceId {
  return operationType === 'roleplay' ? 'roleplay' : 'rewrite'
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)))
}

function normalizeBranchContextInclusion(value: unknown) {
  return value === 'include_selected' || value === 'ancestors_only'
    ? value
    : undefined
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

function getExplicitStreamOverride(body: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(body, 'stream')
    ? { present: true, value: body.stream === true }
    : { present: false, value: null }
}

function buildRouteContextBlocks(promptBlocks: readonly GenerationContextBlock[] | null) {
  return promptBlocks
    ? promptBlocks.map((block) => ({
        id: block.id,
        priority: block.priority,
        content: block.content,
      }))
    : null
}

async function writeRewriteOutputRuntimeDebugArtifact(params: {
  request: Request
  body: unknown
  runtime: ReturnType<typeof applyPresetCompatCreativeRuntime>
  streamed: boolean
  presetCompatMetadata: unknown
  outputTransform: {
    preRegexText?: string
    postRegexText?: string
    candidates?: Array<{
      preRegexText: string
      postRegexText: string
    }>
  }
}) {
  await writeLlmDebugLog({
    folder: 'rewrite',
    provider: params.runtime.resolvedRuntime.providerRuntime.provider,
    model: params.runtime.resolvedRuntime.providerRuntime.config.model ?? 'unknown',
    streamed: params.streamed,
    stage: 'output-runtime',
    presetCompat: params.presetCompatMetadata,
    request: {
      url: params.request.url,
      body: params.body,
    },
    response: {
      outputTransform: params.outputTransform,
    },
  })
}

export async function POST(request: Request) {
  const body = await request.json()
  const rewriteSettings = loadStoredAISettings().rewrite
  const rewriteProvider = rewriteSettings.provider
  const userInstruction = String(body.userInstruction ?? body.prompt ?? '')

  const sourceText = String(body.sourceText ?? '')
  const selectedText = String(body.selectedText ?? body.sourceText ?? '')
  const operationType = parseOperationType(body.operationType)
  if (!operationType) {
    return NextResponse.json({ ok: false, error: INVALID_OPERATION_TYPE_ERROR }, { status: 400 })
  }
  const runtimeSurfaceId = resolveRewriteRouteSurfaceId(operationType)
  const disabledBlockIds = Array.isArray(body.disabledBlockIds) ? body.disabledBlockIds.map((item: unknown) => String(item)) : []
  const excludedGraphEdgeIds = normalizeStringArray(body.excludedGraphEdgeIds)
  const excludedEvidenceIds = normalizeStringArray(body.excludedEvidenceIds)
  const context = body.novelId && body.chapterId
    ? await buildGenerationContext({
        novelId: String(body.novelId),
        branchId: body.branchId ? String(body.branchId) : undefined,
        chapterId: String(body.chapterId),
        selectedText,
        operationType: runtimeSurfaceId,
        userInstruction,
        excludedGraphEdgeIds,
        excludedEvidenceIds,
        whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
        futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
        branchContextNodeId: body.branchContextNodeId ? String(body.branchContextNodeId) : undefined,
        branchContextInclusion: normalizeBranchContextInclusion(body.branchContextInclusion),
      })
    : null
  const activePromptBlocks = context
    ? context.promptBlocks.filter((block) => !disabledBlockIds.includes(block.id))
    : null
  const buildRuntime = (
    assembledContext: string,
    promptBlocks: readonly GenerationContextBlock[] | null,
  ) => applyPresetCompatCreativeRuntime({
    surfaceId: runtimeSurfaceId,
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
    systemPrompt: '',
    userPrompt: buildUserPrompt({
      operationType: runtimeSurfaceId,
      userInstruction,
      chapterNo: context?.chapterNo,
      selectedLineStart: context?.selectedLineStart,
      selectedLineEnd: context?.selectedLineEnd,
      selectedText,
      assembledContext,
    }),
    promptRuleRuntimeContext: normalizePresetCompatRuntimeContext(
      body as Record<string, unknown>,
      runtimeSurfaceId,
      promptBlocks,
    ),
  })
  const initialAssembledContext = activePromptBlocks
    ? activePromptBlocks.map((block) => block.content).join('\n\n')
    : String(body.prompt ?? '')
  const initialRuntime = buildRuntime(initialAssembledContext, activePromptBlocks)
  const requestStreamOverride = getExplicitStreamOverride(body as Record<string, unknown>)
  const initialRouteMetadata = resolveCreativeRoutePresetCompatMetadata({
    runtime: initialRuntime,
    blocks: buildRouteContextBlocks(activePromptBlocks),
    requestOverride: requestStreamOverride,
    providerDefaultEnabled: false,
    streamSupported: true,
  })
  const trimmedPromptBlocks = activePromptBlocks
    ? activePromptBlocks.filter((block) => !initialRouteMetadata.contextWindow?.trimmedBlockIds.includes(block.id))
    : null
  const assembledContext = activePromptBlocks
    ? (trimmedPromptBlocks ?? []).map((block) => block.content)
        .join('\n\n')
    : String(body.prompt ?? '')
  const runtime = buildRuntime(assembledContext, trimmedPromptBlocks)
  const routeMetadata = resolveCreativeRoutePresetCompatMetadata({
    runtime,
    blocks: buildRouteContextBlocks(trimmedPromptBlocks),
    requestOverride: requestStreamOverride,
    providerDefaultEnabled: false,
    streamSupported: true,
  })
  const presetCompatMetadata = {
    ...routeMetadata.metadata,
    contextWindow: initialRouteMetadata.contextWindow,
  }
  const presetCompatHeader = serializePresetCompatResponseMetadata(presetCompatMetadata)

  if (routeMetadata.streamPolicy?.effective) {
    const promptPayload = {
      systemPrompt: runtime.systemPrompt,
      userPrompt: runtime.userPrompt,
      temperature: body.tone === 'keep' ? 0.7 : 0.9,
      requestOptions: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
        ? runtime.resolvedRuntime.providerRuntime.request
        : runtime.resolvedRuntime.providerRuntime.request.options,
      presetCompat: presetCompatMetadata,
    }
    const streamResult = runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
      ? await streamRewriteWithOpenAICompatible(promptPayload, runtime.resolvedRuntime.providerRuntime.config)
      : await streamRewriteWithOllama(promptPayload, runtime.resolvedRuntime.providerRuntime.config)

    if (streamResult.enabled && streamResult.stream) {
      if (runtime.hasActiveOutputRegex) {
        const transformedStream = await bufferAndTransformTextStream(streamResult.stream, (value) => runtime.applyOutputRuntime(value).value)

        await writeRewriteOutputRuntimeDebugArtifact({
          request,
          body,
          runtime,
          streamed: true,
          presetCompatMetadata,
          outputTransform: {
            preRegexText: transformedStream.rawText,
            postRegexText: transformedStream.transformedText,
          },
        })

        return new Response(transformedStream.stream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-ChatBook-Preset-Compat': presetCompatHeader,
          },
        })
      }

      return new Response(streamResult.stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-ChatBook-Preset-Compat': presetCompatHeader,
        },
      })
    }

    const fallback = buildFallbackText(sourceText || selectedText, String(body.mode ?? ''), String(body.tone ?? ''), String(body.prompt ?? ''))
    return new Response(streamResult.error ? buildFallbackRewriteStream(`${fallback}\n`) : buildFallbackRewriteStream(fallback), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-ChatBook-Preset-Compat': presetCompatHeader,
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
    presetCompat: presetCompatMetadata,
  }
  const result = runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
    ? await generateRewriteWithOpenAICompatible(rewriteInput, runtime.resolvedRuntime.providerRuntime.config)
    : await generateRewriteWithOllama(rewriteInput, runtime.resolvedRuntime.providerRuntime.config)

  if (result.enabled && result.content?.length) {
    const transformedCandidates = result.content.map((content) => {
      const outputRuntime = runtime.applyOutputRuntime(content)
      return {
        preRegexText: content,
        postRegexText: outputRuntime.value,
      }
    })

    if (runtime.hasActiveOutputRegex) {
      await writeRewriteOutputRuntimeDebugArtifact({
        request,
        body,
        runtime,
        streamed: false,
        presetCompatMetadata,
        outputTransform: {
          candidates: transformedCandidates,
        },
      })
    }

    return NextResponse.json({
      provider: runtime.resolvedRuntime.providerRuntime.provider,
      metadata: runtime.metadata,
      candidates: transformedCandidates.map(({ postRegexText }, index) => ({
        title: `候选 ${String.fromCharCode(65 + index)}`,
        summary: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible' ? '来自 OpenAI-compatible API' : '来自 Ollama 本地模型',
        content: postRegexText,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
      })),
      presetCompat: presetCompatMetadata,
    }, {
      headers: {
        'X-ChatBook-Preset-Compat': presetCompatHeader,
      },
    })
  }

  return NextResponse.json({
    provider: result.enabled ? 'fallback-after-error' : 'fallback-no-config',
    metadata: runtime.metadata,
    error: result.error,
    candidates: fallbackCandidates(body.sourceText, body.mode, body.tone, body.prompt),
    presetCompat: presetCompatMetadata,
  }, {
    headers: {
      'X-ChatBook-Preset-Compat': presetCompatHeader,
    },
  })
}
