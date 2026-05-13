import { NextResponse } from 'next/server'
import { buildGenerationContextPreview } from '@/lib/server/context-builder'
import {
  buildFallbackRewriteStream,
  generateRewriteWithOpenAICompatible,
  streamRewriteWithOpenAICompatible,
} from '@/lib/server/openai-compatible'
import { generateRewriteWithOllama, streamRewriteWithOllama } from '@/lib/server/ollama-local'
import { findAppSettings } from '@/lib/server/persistence'

function getRewriteProvider() {
  const provider = findAppSettings(['AI_REWRITE_PROVIDER'])[0]?.value?.trim()
  return provider === 'ollama' ? 'ollama' : 'openai-compatible'
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
  const rewriteProvider = getRewriteProvider()

  const sourceText = String(body.sourceText ?? '')
  const selectedText = String(body.selectedText ?? body.sourceText ?? '')
  const operationType = String(body.operationType ?? body.mode ?? 'expand')
  const disabledBlockIds = Array.isArray(body.disabledBlockIds) ? body.disabledBlockIds.map((item: unknown) => String(item)) : []

  if (body.stream) {
    const preview = body.novelId && body.chapterId
      ? await buildGenerationContextPreview({
          novelId: String(body.novelId),
          branchId: body.branchId ? String(body.branchId) : undefined,
          chapterId: String(body.chapterId),
          selectedText,
          operationType: body.operationType ?? 'expand',
          userInstruction: String(body.userInstruction ?? body.prompt ?? ''),
        })
      : null

    const assembledContext = preview
      ? preview.blocks
          .filter((block) => !disabledBlockIds.includes(block.id))
          .map((block) => block.content)
          .join('\n\n')
      : String(body.prompt ?? '')

    const promptPayload = {
      systemPrompt: buildSystemPrompt(),
      userPrompt: buildUserPrompt({
        operationType,
        userInstruction: String(body.userInstruction ?? body.prompt ?? ''),
        chapterNo: preview?.chapterNo,
        selectedLineStart: preview?.selectedLineStart,
        selectedLineEnd: preview?.selectedLineEnd,
        selectedText,
        assembledContext,
      }),
      temperature: body.tone === 'keep' ? 0.7 : 0.9,
    }
    const result = rewriteProvider === 'ollama'
      ? await streamRewriteWithOllama(promptPayload)
      : await streamRewriteWithOpenAICompatible(promptPayload)

    if (result.enabled && result.stream) {
      return new Response(result.stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      })
    }

    const fallback = buildFallbackText(sourceText || selectedText, String(body.mode ?? ''), String(body.tone ?? ''), String(body.prompt ?? ''))
    return new Response(result.error ? buildFallbackRewriteStream(`${fallback}\n`) : buildFallbackRewriteStream(fallback), {
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
    prompt: body.prompt,
    keepCanon: Boolean(body.keepCanon),
    autoContinue: Boolean(body.autoContinue),
    thoughtLevel: body.thoughtLevel,
  }
  const result = rewriteProvider === 'ollama'
    ? await generateRewriteWithOllama(rewriteInput)
    : await generateRewriteWithOpenAICompatible(rewriteInput)

  if (result.enabled && result.content?.length) {
    return NextResponse.json({
      provider: rewriteProvider,
      candidates: result.content.map((content, index) => ({
        title: `候选 ${String.fromCharCode(65 + index)}`,
        summary: rewriteProvider === 'ollama' ? '来自本地 Ollama' : '来自 OpenAI-compatible API',
        content,
      })),
    })
  }

  return NextResponse.json({
    provider: result.enabled ? 'fallback-after-error' : 'fallback-no-config',
    error: result.error,
    candidates: fallbackCandidates(body.sourceText, body.mode, body.tone, body.prompt),
  })
}
