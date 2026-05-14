import type { Chapter, KnowledgeExtractionScenarioSettings } from '@/lib/types'
import { type ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import { extractChapterKnowledgeWithOpenAICompatible } from '@/lib/server/openai-compatible'
import { extractChapterKnowledgeWithOllama } from '@/lib/server/ollama-local'

type KnowledgeProvider = 'openai-compatible' | 'ollama'

type KnowledgeExtractionRetryBucket = {
  consecutiveFailures: number
  cooldownUntil: number
  retryTail: Promise<void>
}

const INITIAL_RETRY_COOLDOWN_MS = 15_000
const MAX_RETRY_COOLDOWN_MS = 60 * 60 * 1000
const retryBuckets = new Map<string, KnowledgeExtractionRetryBucket>()

export type OfflineExtractionResult = {
  extraction: ChapterKnowledgeExtraction
  provider: KnowledgeProvider | 'fallback'
  model?: string
}

function buildFallbackExtraction(rawText: string, chapterNo: number): ChapterKnowledgeExtraction {
  const summaryEvent = buildConservativeSummaryEvent(rawText, chapterNo, rawText.replace(/\s+/g, ' ').trim().slice(0, 180))
  const summarySource = rawText.replace(/\s+/g, ' ').trim()
  const summary = summarySource ? summarySource.slice(0, 180) : `第 ${chapterNo} 章`
  return {
    chapterNo,
    summary,
    characters: [],
    relations: [],
    events: summaryEvent ? [summaryEvent] : [],
    worldbuilding: [],
    openThreads: [],
  }
}

function buildConservativeSummaryEvent(rawText: string, chapterNo: number, summary: string) {
  const normalizedSummary = summary.trim()
  if (!normalizedSummary) {
    return null
  }

  const firstNumberedLine = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .find((item) => item.line)

  const eventNameSource = normalizedSummary.split(/[，。；：,.!?！？]/)[0]?.trim() ?? normalizedSummary
  const eventName = eventNameSource.length <= 24 ? eventNameSource : `${eventNameSource.slice(0, 24).trim()}…`

  return {
    name: eventName || `第 ${chapterNo} 章`,
    summary: normalizedSummary,
    eventType: 'story',
    participants: [],
    consequences: '',
    importance: 2,
    evidence: firstNumberedLine
      ? [{ quote: firstNumberedLine.line.slice(0, 140), lineStart: firstNumberedLine.lineNumber, lineEnd: firstNumberedLine.lineNumber }]
      : [],
  }
}

function ensureTimelineCoverage(extraction: ChapterKnowledgeExtraction, rawText: string) {
  if (extraction.events.length > 0) {
    return extraction
  }

  const summaryEvent = buildConservativeSummaryEvent(rawText, extraction.chapterNo, extraction.summary)
  if (!summaryEvent) {
    return extraction
  }

  return {
    ...extraction,
    events: [summaryEvent],
  }
}

function getRetryBucketKey(settings: KnowledgeExtractionScenarioSettings) {
  const providerSettings = settings.provider === 'openai-compatible'
    ? settings.openAICompatible
    : settings.ollama

  return [settings.provider, providerSettings.baseUrl.trim(), providerSettings.model.trim()].join('::')
}

function getRetryBucket(settings: KnowledgeExtractionScenarioSettings) {
  const key = getRetryBucketKey(settings)
  const existing = retryBuckets.get(key)
  if (existing) {
    return existing
  }

  const created: KnowledgeExtractionRetryBucket = {
    consecutiveFailures: 0,
    cooldownUntil: 0,
    retryTail: Promise.resolve(),
  }
  retryBuckets.set(key, created)
  return created
}

function markRetrySuccess(bucket: KnowledgeExtractionRetryBucket) {
  bucket.consecutiveFailures = 0
  bucket.cooldownUntil = 0
}

function markRetryFailure(bucket: KnowledgeExtractionRetryBucket) {
  bucket.consecutiveFailures += 1
  const cooldownMs = Math.min(
    MAX_RETRY_COOLDOWN_MS,
    INITIAL_RETRY_COOLDOWN_MS * 2 ** Math.max(0, bucket.consecutiveFailures - 1)
  )
  bucket.cooldownUntil = Date.now() + cooldownMs
}

async function waitForRetryCooldown(ms: number, assertCanContinue?: () => void | Promise<void>) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await assertCanContinue?.()
    const remaining = deadline - Date.now()
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining)))
  }
  await assertCanContinue?.()
}

async function runSerializedRetry<T>(bucket: KnowledgeExtractionRetryBucket, task: () => Promise<T>) {
  const previous = bucket.retryTail
  let release: () => void = () => {}
  bucket.retryTail = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

async function performProviderExtraction(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  mode: 'full' | 'focused'
  settings: KnowledgeExtractionScenarioSettings
}) {
  if (params.settings.provider === 'openai-compatible') {
    return await extractChapterKnowledgeWithOpenAICompatible(params, params.settings.openAICompatible)
  }
  return await extractChapterKnowledgeWithOllama(params, params.settings.ollama)
}

async function runProviderExtraction(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  mode: 'full' | 'focused'
  settings: KnowledgeExtractionScenarioSettings
  assertCanContinue?: () => void | Promise<void>
}) {
  const bucket = getRetryBucket(params.settings)
  const attempt = async () => performProviderExtraction(params)

  const firstResult = await attempt()
  if (!firstResult.enabled) {
    return firstResult
  }
  if (firstResult.extraction) {
    markRetrySuccess(bucket)
    return firstResult
  }

  markRetryFailure(bucket)

  return await runSerializedRetry(bucket, async () => {
    const cooldownMs = Math.max(0, bucket.cooldownUntil - Date.now())
    if (cooldownMs > 0) {
      await waitForRetryCooldown(cooldownMs, params.assertCanContinue)
    }

    await params.assertCanContinue?.()
    const retryResult = await attempt()
    if (!retryResult.enabled) {
      return retryResult
    }
    if (retryResult.extraction) {
      markRetrySuccess(bucket)
      return retryResult
    }

    markRetryFailure(bucket)
    return retryResult
  })
}

function normalizeRelationKey(relation: ChapterKnowledgeExtraction['relations'][number]) {
  return [relation.source, relation.target, relation.type]
    .map((part) => part.trim().toLocaleLowerCase('en-US'))
    .join('::')
}

function normalizeWorldbuildingKey(entry: ChapterKnowledgeExtraction['worldbuilding'][number]) {
  return [entry.term, entry.category]
    .map((part) => part.trim().toLocaleLowerCase('en-US'))
    .join('::')
}

function normalizeOpenThreadKey(thread: ChapterKnowledgeExtraction['openThreads'][number]) {
  return thread.name.trim().toLocaleLowerCase('en-US')
}

function chooseConciseText(existing: string, incoming: string) {
  const left = existing.trim()
  const right = incoming.trim()
  if (!left) return right
  if (!right) return left
  if (left === right) return left
  if (left.includes(right)) return right
  if (right.includes(left)) return left
  return left.length <= right.length ? left : right
}

function mergeEvidence(
  left: ChapterKnowledgeExtraction['relations'][number]['evidence'],
  right: ChapterKnowledgeExtraction['relations'][number]['evidence']
) {
  const merged = [...left, ...right]
  const seen = new Set<string>()

  return merged.filter((item) => {
    const key = `${item.quote}::${item.lineStart}::${item.lineEnd}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeFocusedKnowledge(
  base: ChapterKnowledgeExtraction,
  supplement: ChapterKnowledgeExtraction
): ChapterKnowledgeExtraction {
  const relationMap = new Map(
    base.relations.map((relation) => [normalizeRelationKey(relation), relation] as const)
  )

  for (const relation of supplement.relations) {
    const key = normalizeRelationKey(relation)
    const existing = relationMap.get(key)
    if (!existing) {
      relationMap.set(key, relation)
      continue
    }

    relationMap.set(key, {
      ...existing,
      polarity: existing.polarity === 'neutral' ? relation.polarity : existing.polarity,
      strength: Math.max(existing.strength, relation.strength),
      change: chooseConciseText(existing.change, relation.change),
      validFromChapter: Math.min(existing.validFromChapter, relation.validFromChapter),
      evidence: mergeEvidence(existing.evidence, relation.evidence),
    })
  }

  const worldbuildingMap = new Map(
    base.worldbuilding.map((entry) => [normalizeWorldbuildingKey(entry), entry] as const)
  )

  for (const entry of supplement.worldbuilding) {
    const key = normalizeWorldbuildingKey(entry)
    const existing = worldbuildingMap.get(key)
    if (!existing) {
      worldbuildingMap.set(key, entry)
      continue
    }

    worldbuildingMap.set(key, {
      ...existing,
      definition: chooseConciseText(existing.definition, entry.definition),
      evidence: mergeEvidence(existing.evidence, entry.evidence),
    })
  }

  const openThreadMap = new Map(
    base.openThreads.map((thread) => [normalizeOpenThreadKey(thread), thread] as const)
  )

  for (const thread of supplement.openThreads) {
    const key = normalizeOpenThreadKey(thread)
    const existing = openThreadMap.get(key)
    if (!existing) {
      openThreadMap.set(key, thread)
      continue
    }

    openThreadMap.set(key, {
      ...existing,
      description: chooseConciseText(existing.description, thread.description),
      evidence: mergeEvidence(existing.evidence, thread.evidence),
    })
  }

  return {
    ...base,
    summary: base.summary || supplement.summary,
    relations: [...relationMap.values()],
    worldbuilding: [...worldbuildingMap.values()],
    openThreads: [...openThreadMap.values()],
  }
}

export async function extractChapterKnowledgeOffline(params: {
  chapter: Chapter
  chapterNo: number
  settings: KnowledgeExtractionScenarioSettings
  assertCanContinue?: () => void | Promise<void>
}): Promise<OfflineExtractionResult> {
  const rawText = params.chapter.content
    .replace(/<\/p>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  const provider = params.settings.provider
  const primary = await runProviderExtraction({
    chapterTitle: params.chapter.title,
    chapterNo: params.chapterNo,
    rawText,
    mode: 'full',
    settings: params.settings,
    assertCanContinue: params.assertCanContinue,
  })

  if (primary.enabled && primary.extraction) {
    const successfulExtraction = primary.extraction
    if (!successfulExtraction) {
      throw new Error('Knowledge extraction unexpectedly succeeded without extraction payload')
    }

    const focused = await runProviderExtraction({
      chapterTitle: params.chapter.title,
      chapterNo: params.chapterNo,
      rawText,
      mode: 'focused',
      settings: params.settings,
      assertCanContinue: params.assertCanContinue,
    })

    return {
      extraction: ensureTimelineCoverage(focused.enabled && focused.extraction
        ? mergeFocusedKnowledge(successfulExtraction, focused.extraction)
        : successfulExtraction, rawText),
      provider,
      model: primary.model,
    }
  }

  if (primary.error) {
    console.error('Knowledge extraction falling back to conservative projection', {
      chapterTitle: params.chapter.title,
      chapterNo: params.chapterNo,
      error: primary.error,
      model: primary.model,
      provider,
    })
  }

  return {
    extraction: buildFallbackExtraction(rawText, params.chapterNo),
    provider: 'fallback',
    model: primary.model,
  }
}
