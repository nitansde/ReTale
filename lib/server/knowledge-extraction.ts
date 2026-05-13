import type { Chapter } from '@/lib/types'
import { type ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import { findAppSettings } from '@/lib/server/persistence'
import { extractChapterKnowledgeWithOllama } from '@/lib/server/ollama-local'
import { extractChapterKnowledgeWithOpenAICompatible } from '@/lib/server/openai-compatible'

type KnowledgeProvider = 'ollama' | 'openai-compatible'

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

function getKnowledgeProvider(): KnowledgeProvider {
  const [entry] = findAppSettings(['AI_KNOWLEDGE_PROVIDER'])
  const configured = entry?.value?.trim()
  if (configured === 'openai-compatible') {
    return 'openai-compatible'
  }
  if (configured === 'ollama') {
    return 'ollama'
  }
  return process.env.AI_KNOWLEDGE_PROVIDER === 'openai-compatible' ? 'openai-compatible' : 'ollama'
}

async function runProviderExtraction(params: {
  provider: KnowledgeProvider
  chapterTitle: string
  chapterNo: number
  rawText: string
  mode: 'full' | 'focused'
}) {
  if (params.provider === 'openai-compatible') {
    return await extractChapterKnowledgeWithOpenAICompatible(params)
  }

  return await extractChapterKnowledgeWithOllama(params)
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
      change: relation.change.length > existing.change.length ? relation.change : existing.change,
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
      definition: entry.definition.length > existing.definition.length ? entry.definition : existing.definition,
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
      description: thread.description.length > existing.description.length ? thread.description : existing.description,
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
}): Promise<OfflineExtractionResult> {
  const rawText = params.chapter.content
    .replace(/<\/p>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  const provider = getKnowledgeProvider()
  const fallbackProvider: KnowledgeProvider = provider === 'openai-compatible' ? 'ollama' : 'openai-compatible'
  const primary = await runProviderExtraction({
    provider,
    chapterTitle: params.chapter.title,
    chapterNo: params.chapterNo,
    rawText,
    mode: 'full',
  })

  const chosen = primary.enabled && primary.extraction
    ? { provider, result: primary }
    : null

  const rescue = chosen
    ? null
    : await runProviderExtraction({
        provider: fallbackProvider,
        chapterTitle: params.chapter.title,
        chapterNo: params.chapterNo,
        rawText,
        mode: 'full',
      })

  const successful = chosen ?? (rescue?.enabled && rescue.extraction
    ? { provider: fallbackProvider, result: rescue }
    : null)

  if (successful) {
    const successfulExtraction = successful.result.extraction
    if (!successfulExtraction) {
      throw new Error('Knowledge extraction unexpectedly succeeded without extraction payload')
    }

    const focused = await runProviderExtraction({
      provider: successful.provider,
      chapterTitle: params.chapter.title,
      chapterNo: params.chapterNo,
      rawText,
      mode: 'focused',
    })

    return {
      extraction: ensureTimelineCoverage(focused.enabled && focused.extraction
        ? mergeFocusedKnowledge(successfulExtraction, focused.extraction)
        : successfulExtraction, rawText),
      provider: successful.provider,
      model: successful.result.model,
    }
  }

  if (primary.error || rescue?.error) {
    console.error('Knowledge extraction falling back to conservative projection', {
      chapterTitle: params.chapter.title,
      chapterNo: params.chapterNo,
      error: primary.error || rescue?.error,
      model: primary.model || rescue?.model,
      provider,
      rescueProvider: rescue ? fallbackProvider : null,
      rescueError: rescue?.error,
    })
  }

  return {
    extraction: buildFallbackExtraction(rawText, params.chapterNo),
    provider: 'fallback',
    model: primary.model || rescue?.model,
  }
}
