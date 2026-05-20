import { htmlToPlainText } from '@/lib/utils'
import type { Chapter, Character, CharacterRelation, OutlineItem, TimelineEvent, WorldEntry } from '@/lib/types'

export type CharacterRoleCardFacet = {
  summary: string
  note?: string
  evidence?: string
}

export type CharacterRoleCardProfile = {
  personality?: CharacterRoleCardFacet
  gender?: CharacterRoleCardFacet
  identity?: CharacterRoleCardFacet
  capability?: CharacterRoleCardFacet
  appearance?: CharacterRoleCardFacet
  body?: CharacterRoleCardFacet
  clothing?: CharacterRoleCardFacet
  speakingStyle?: CharacterRoleCardFacet
  likes?: CharacterRoleCardFacet
}

export const CHARACTER_ROLE_CARD_KEYS = [
  'personality',
  'gender',
  'identity',
  'capability',
  'appearance',
  'body',
  'clothing',
  'speakingStyle',
  'likes',
] as const

export type CharacterRoleCardKey = typeof CHARACTER_ROLE_CARD_KEYS[number]

const CHARACTER_ROLE_CARD_LABELS: Record<CharacterRoleCardKey, string> = {
  personality: '性格',
  gender: '性别',
  identity: '身份',
  capability: '能力',
  appearance: '外形',
  body: '体态',
  clothing: '衣着',
  speakingStyle: '说话风格',
  likes: '偏好',
}

export type KnownCharacterUpdate = {
  name: string
  descriptionDelta: string
  profile: CharacterRoleCardProfile
  evidence: KnowledgeEvidence[]
}

export type UnknownCharacterObservation = {
  surfaceText: string
  observation: string
  profile: CharacterRoleCardProfile
  evidence: KnowledgeEvidence[]
}

export type AliasDiscovery = {
  alias: string
  target: string
}

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
  profile: CharacterRoleCardProfile
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
  knownCharacterUpdates: KnownCharacterUpdate[]
  unknownCharacterObservations: UnknownCharacterObservation[]
  aliasDiscoveries: AliasDiscovery[]
  relations: ExtractedChapterRelation[]
  events: ExtractedChapterEvent[]
  worldbuilding: ExtractedWorldbuilding[]
  openThreads: ExtractedOpenThread[]
}

const NO_CHANGE_PROFILE_KEYS = new Set<CharacterRoleCardKey>(['appearance', 'body', 'clothing'])

function isNoChangeText(value?: string) {
  return value?.trim() === '没有变化'
}

function normalizeRoleCardFacetValue(raw: unknown): CharacterRoleCardFacet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!summary) return undefined
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : ''
  return {
    summary,
    note: note || undefined,
    evidence: evidence || undefined,
  }
}

export function normalizeCharacterRoleCardProfile(raw: unknown): CharacterRoleCardProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const profile: CharacterRoleCardProfile = {}
  for (const key of CHARACTER_ROLE_CARD_KEYS) {
    const facet = normalizeRoleCardFacetValue(record[key])
    if (facet) {
      profile[key] = facet
    }
  }
  return profile
}

export function hasCharacterRoleCardProfile(profile: CharacterRoleCardProfile | null | undefined) {
  return CHARACTER_ROLE_CARD_KEYS.some((key) => Boolean(profile?.[key]?.summary?.trim()))
}

function chooseLeanText(existing?: string, incoming?: string) {
  const left = existing?.trim() || ''
  const right = incoming?.trim() || ''
  if (!left) return right
  if (!right) return left
  if (left === right) return left
  if (left.includes(right)) return right
  if (right.includes(left)) return left
  return left.length <= right.length ? left : right
}

export function mergeCharacterRoleCardProfiles(
  base: CharacterRoleCardProfile | null | undefined,
  incoming: CharacterRoleCardProfile | null | undefined,
): CharacterRoleCardProfile {
  const next: CharacterRoleCardProfile = { ...(base ?? {}) }
  for (const key of CHARACTER_ROLE_CARD_KEYS) {
    const left = base?.[key]
    const right = incoming?.[key]
    if (NO_CHANGE_PROFILE_KEYS.has(key) && isNoChangeText(right?.summary)) {
      if (left?.summary) {
        next[key] = { ...left }
      }
      continue
    }
    const summary = chooseLeanText(left?.summary, right?.summary)
    const note = chooseLeanText(left?.note, right?.note)
    const evidence = chooseLeanText(left?.evidence, right?.evidence)
    if (summary) {
      next[key] = {
        summary,
        note: note || undefined,
        evidence: evidence || undefined,
      }
    }
  }
  return next
}

export function buildCharacterDescriptionDelta(profile: CharacterRoleCardProfile, fallback = '') {
  const identity = profile.identity?.summary
  const capability = profile.capability?.summary
  const personality = profile.personality?.summary
  return [identity, capability, personality, fallback.trim()].filter(Boolean).slice(0, 3).join('｜')
}

export function buildCharacterRoleCardLines(profile: CharacterRoleCardProfile, options?: { includeEvidence?: boolean; includeNotes?: boolean }) {
  const includeEvidence = options?.includeEvidence ?? false
  const includeNotes = options?.includeNotes ?? true
  return CHARACTER_ROLE_CARD_KEYS.flatMap((key) => {
    const facet = profile[key]
    if (!facet?.summary?.trim()) return []
    const parts = [facet.summary.trim()]
    if (includeNotes && facet.note?.trim()) parts.push(`注：${facet.note.trim()}`)
    if (includeEvidence && facet.evidence?.trim()) parts.push(`证：${facet.evidence.trim()}`)
    return [`${CHARACTER_ROLE_CARD_LABELS[key]}：${parts.join('｜')}`]
  })
}

export function buildCharacterPromptCard(character: Character) {
  const profile = character.profile
  const profileLines = profile && hasCharacterRoleCardProfile(profile)
    ? buildCharacterRoleCardLines(profile)
    : []
  const fallbackLines = [
    character.role.trim() ? `角色：${character.role.trim()}` : '',
    character.goal.trim() ? `目标：${character.goal.trim()}` : '',
    character.trait.trim() ? `性格：${character.trait.trim()}` : '',
    character.note.trim() ? `备注：${character.note.trim()}` : '',
  ].filter(Boolean)
  return `- ${character.name}｜${(profileLines.length ? profileLines : fallbackLines).join('｜')}`
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
    ...params.characters.slice(0, 16).map((char) => buildCharacterPromptCard(char)),
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
