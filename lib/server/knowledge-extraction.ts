import type { Chapter } from '@/lib/types'
import { type ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import { extractChapterKnowledgeWithOllama } from '@/lib/server/ollama-local'

export type OfflineExtractionResult = {
  extraction: ChapterKnowledgeExtraction
  provider: 'ollama' | 'fallback'
  model?: string
}

function buildFallbackExtraction(rawText: string, chapterNo: number): ChapterKnowledgeExtraction {
  const summarySource = rawText.replace(/\s+/g, ' ').trim()
  return {
    chapterNo,
    summary: summarySource ? summarySource.slice(0, 180) : `第 ${chapterNo} 章`,
    characters: [],
    relations: [],
    events: [],
    worldbuilding: [],
    openThreads: [],
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

  const ollama = await extractChapterKnowledgeWithOllama({
    chapterTitle: params.chapter.title,
    chapterNo: params.chapterNo,
    rawText,
  })

  if (ollama.enabled && ollama.extraction) {
    return {
      extraction: ollama.extraction,
      provider: 'ollama',
      model: ollama.model,
    }
  }

  if (ollama.error) {
    console.error('Knowledge extraction falling back to empty projection', {
      chapterTitle: params.chapter.title,
      chapterNo: params.chapterNo,
      error: ollama.error,
      model: ollama.model,
    })
  }

  return {
    extraction: buildFallbackExtraction(rawText, params.chapterNo),
    provider: 'fallback',
    model: ollama.model,
  }
}
