import { htmlToPlainText } from '@/lib/utils'
import type { Chapter, Character, CharacterRelation, OutlineItem, TimelineEvent, WorldEntry } from '@/lib/types'

export type KnowledgeEvidence = {
  quote: string
  lineStart: number
  lineEnd: number
}

export type ExtractedChapterCharacter = {
  name: string
  aliases: string[]
  status: string
  descriptionDelta: string
  evidence: KnowledgeEvidence[]
}

export type ExtractedChapterRelation = {
  source: string
  target: string
  type: string
  polarity: 'positive' | 'negative' | 'neutral' | 'mixed'
  strength: number
  change: string
  validFromChapter: number
  evidence: KnowledgeEvidence[]
}

export type ExtractedChapterEvent = {
  name: string
  summary: string
  eventType: string
  participants: Array<{ name: string; role: string }>
  consequences: string
  importance: number
  evidence: KnowledgeEvidence[]
}

export type ExtractedWorldbuilding = {
  term: string
  category: string
  definition: string
  evidence: KnowledgeEvidence[]
}

export type ExtractedOpenThread = {
  name: string
  description: string
  evidence: KnowledgeEvidence[]
}

export type ChapterKnowledgeExtraction = {
  chapterNo: number
  summary: string
  characters: ExtractedChapterCharacter[]
  relations: ExtractedChapterRelation[]
  events: ExtractedChapterEvent[]
  worldbuilding: ExtractedWorldbuilding[]
  openThreads: ExtractedOpenThread[]
}

export function buildGenerationContext(params: {
  currentChapter: Chapter
  chapters: Chapter[]
  selectionText?: string
  characters: Character[]
  relations: CharacterRelation[]
  worldEntries: WorldEntry[]
  timelineEvents: TimelineEvent[]
  outlines: OutlineItem[]
  recentChapterCount?: number
}) {
  const { currentChapter } = params
  const recentChapterCount = params.recentChapterCount ?? 3
  const sorted = params.chapters.slice().sort((a, b) => a.order - b.order)
  const currentIndex = sorted.findIndex((item) => item.id === currentChapter.id)
  const recent = sorted.slice(Math.max(0, currentIndex - recentChapterCount), currentIndex + 1)

  const relatedTimeline = params.timelineEvents.filter((item) => item.chapterIds.includes(currentChapter.id)).slice(0, 6)
  const relatedOutlines = params.outlines.filter((item) => item.relatedChapterIds.includes(currentChapter.id)).slice(0, 6)
  const relatedRelations = params.relations.filter((item) => item.chapterIds.includes(currentChapter.id)).slice(0, 8)

  return [
    `当前章节：${currentChapter.title}`,
    params.selectionText?.trim() ? `当前处理片段：${params.selectionText.trim()}` : '',
    '',
    '【最近章节上下文】',
    ...recent.map((chapter) => `- ${chapter.title}：${htmlToPlainText(chapter.content).slice(0, 280)}`),
    '',
    '【人物卡】',
    ...params.characters.slice(0, 16).map((char) => `- ${char.name}｜${char.role}｜目标：${char.goal}｜性格：${char.trait}｜备注：${char.note}`),
    '',
    '【人物关系网】',
    ...relatedRelations.map((rel) => `- ${params.characters.find((c) => c.id === rel.fromCharacterId)?.name ?? rel.fromCharacterId} -> ${params.characters.find((c) => c.id === rel.toCharacterId)?.name ?? rel.toCharacterId}｜${rel.label}｜${rel.status}｜${rel.note}`),
    '',
    '【世界设定 / 场景设定】',
    ...params.worldEntries.slice(0, 24).map((entry) => `- ${entry.title}｜${entry.type}｜${entry.content}`),
    '',
    '【时间线】',
    ...relatedTimeline.map((event) => `- ${event.order}. ${event.title}｜${event.phase}｜${event.summary}`),
    '',
    '【剧情大纲】',
    ...relatedOutlines.map((item) => `- ${item.title}｜${item.type}｜${item.summary}`),
  ].filter(Boolean).join('\n')
}
