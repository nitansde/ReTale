import {
  buildCharacterDescriptionDelta,
  normalizeCharacterRoleCardProfile,
  type ChapterKnowledgeExtraction,
  type CharacterRoleCardFacet,
  type CharacterRoleCardProfile,
  type KnowledgeEvidence,
} from '@/lib/story-knowledge'
import type { AIScenarioKey, OllamaProviderSettings } from '@/lib/types'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { findAppSettings } from '@/lib/server/persistence'

type OllamaTagsResponse = {
  models?: Array<{
    name?: string
    model?: string
    modified_at?: string
    size?: number
    details?: {
      family?: string
      parameter_size?: string
      quantization_level?: string
    }
  }>
}

type OllamaShowResponse = {
  capabilities?: string[]
}

type OllamaChatResponse = {
  message?: {
    content?: string
  }
}

type OllamaChatStreamChunk = {
  message?: {
    content?: string
  }
  done?: boolean
  error?: string
}

type OllamaEmbedResponse = {
  model?: string
  embeddings?: number[][]
}

type OllamaConfig = {
  baseUrl: string
  model: string | null
  timeoutMs: number
  enabled: boolean
  reason?: string
}

export type OllamaExtractionResult = {
  enabled: boolean
  extraction?: ChapterKnowledgeExtraction
  model?: string
  error?: string
}

export type KnowledgeExtractionPromptMode = 'full' | 'focused'

type OllamaRewriteRequest = {
  sourceText: string
  mode: string
  tone: string
  scope: string
  prompt: string
  keepCanon: boolean
  autoContinue: boolean
  thoughtLevel: string
}

type OllamaRewriteResult = {
  enabled: boolean
  content?: string[]
  error?: string
}

type OllamaStreamRewriteRequest = {
  systemPrompt: string
  userPrompt: string
  temperature?: number
}

type OllamaStreamRewriteResult = {
  enabled: boolean
  stream?: ReadableStream<Uint8Array>
  error?: string
}

export type OllamaModelOption = {
  id: string
  label: string
  family?: string
  parameterSize?: string
  quantization?: string
  sizeBytes?: number
  modifiedAt?: string
}

export type OllamaEmbeddingResult = {
  enabled: boolean
  embeddings?: number[][]
  model?: string
  error?: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_TIMEOUT_MS = 600000
const EXTRACTION_TOP_LEVEL_ARRAY_KEYS = ['relations', 'events', 'worldbuilding', 'open_threads'] as const
const EXTRACTION_MAX_PROMPT_LINES = 60
const GENERIC_RELATION_TYPE_VALUES = new Set([
  '',
  '关系',
  '人物关系',
  '角色关系',
  '关联',
  '联系',
  '相关',
  '有关联',
  '互动',
  '交集',
  'relation',
  'relationship',
  'related',
])
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    chapter_no: { type: 'integer' },
    summary: { type: 'string' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          status: { type: 'string' },
          description_delta: { type: 'string' },
          profile: {
            type: 'object',
            properties: {
              personality: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
              gender: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
              identity: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
              capability: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
              appearance: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
              clothing: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
              speakingStyle: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
              likes: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  note: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['summary'],
              },
            },
          },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['name', 'aliases', 'status', 'description_delta', 'profile', 'evidence'],
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          type: { type: 'string' },
          polarity: { type: 'string' },
          strength: { type: 'integer' },
          change: { type: 'string' },
          valid_from_chapter: { type: 'integer' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['source', 'target', 'type', 'polarity', 'strength', 'change', 'valid_from_chapter', 'evidence'],
      },
    },
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          event_type: { type: 'string' },
          participants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
              },
              required: ['name', 'role'],
            },
          },
          consequences: { type: 'string' },
          importance: { type: 'integer' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['name', 'summary', 'event_type', 'participants', 'consequences', 'importance', 'evidence'],
      },
    },
    worldbuilding: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          category: { type: 'string' },
          definition: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['term', 'category', 'definition', 'evidence'],
      },
    },
    open_threads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                line_start: { type: 'integer' },
                line_end: { type: 'integer' },
              },
              required: ['quote', 'line_start', 'line_end'],
            },
          },
        },
        required: ['name', 'description', 'evidence'],
      },
    },
  },
  required: ['chapter_no', 'summary', 'characters', 'relations', 'events', 'worldbuilding', 'open_threads'],
} as const

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeEvidence(raw: unknown): KnowledgeEvidence[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const quote = typeof record.quote === 'string'
        ? record.quote.trim()
        : typeof record.text === 'string'
          ? record.text.trim()
          : ''
      const lineStart = Number(record.line_start ?? record.lineStart)
      const lineEnd = Number(record.line_end ?? record.lineEnd ?? lineStart)
      if (!quote || !Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null
      return {
        quote,
        lineStart: Math.max(1, Math.trunc(lineStart)),
        lineEnd: Math.max(Math.trunc(lineStart), Math.trunc(lineEnd)),
      }
    })
    .filter((item): item is KnowledgeEvidence => Boolean(item))
}

function normalizeCompactText(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[：:]+$/g, '').trim()
}

function looksGenericRelationType(value: string) {
  const normalized = normalizeCompactText(value).toLocaleLowerCase('en-US')
  if (!normalized) return true
  if (GENERIC_RELATION_TYPE_VALUES.has(normalized)) return true
  if (/^(人物|角色|双方|两人|二人|彼此|互相)?关系$/.test(value.trim())) return true
  if (/^(人物|角色)?(?:关联|联系|相关)$/.test(value.trim())) return true
  return false
}

function stripGenericRelationSuffix(value: string) {
  const trimmed = normalizeCompactText(value)
  if (!trimmed.endsWith('关系')) return trimmed
  const base = trimmed.slice(0, -2).trim()
  if (!base || looksGenericRelationType(base)) return trimmed
  return base
}

function normalizeRelationType(raw: unknown, fallback?: unknown) {
  const primary = typeof raw === 'string' ? stripGenericRelationSuffix(raw) : ''
  if (primary && !looksGenericRelationType(primary)) {
    return primary
  }

  const secondary = typeof fallback === 'string' ? stripGenericRelationSuffix(fallback) : ''
  if (secondary && !looksGenericRelationType(secondary)) {
    return secondary
  }

  return ''
}

function normalizeWorldCategory(category: string) {
  const normalized = category.trim().toLowerCase()
  if (!normalized) return 'concept'
  if (normalized === 'organization' || normalized === 'faction') return 'politics'
  if (normalized === 'location') return 'geography'
  if (normalized === 'magic_system' || normalized === 'rule') return 'rule'
  return normalized
}

function isGenericWorldTerm(term: string) {
  const normalized = term.trim()
  return normalized === '世界状态' || normalized === '当前世界' || normalized === '本章设定' || normalized === '背景设定'
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringifyLooseValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyLooseValue(item))
      .filter(Boolean)
      .join('、')
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const normalized = stringifyLooseValue(item)
        return normalized ? `${key}：${normalized}` : ''
      })
      .filter(Boolean)
    return entries.join('；')
  }
  return ''
}

function buildFacet(summary: string, note?: string, evidence?: string): CharacterRoleCardFacet | undefined {
  const normalizedSummary = summary.trim()
  if (!normalizedSummary) return undefined
  const normalizedNote = note?.trim() || ''
  const normalizedEvidence = evidence?.trim() || ''
  return {
    summary: normalizedSummary,
    note: normalizedNote || undefined,
    evidence: normalizedEvidence || undefined,
  }
}

function buildEvidenceSnippet(evidence: KnowledgeEvidence[]) {
  return evidence[0]?.quote?.trim() || ''
}

function normasecondSampleProfileFacet(raw: unknown): CharacterRoleCardFacet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : ''
  return buildFacet(summary, note, evidence)
}

function buildProfileFromLooseRecord(record: Record<string, unknown>, evidence: KnowledgeEvidence[]): CharacterRoleCardProfile {
  const evidenceSnippet = buildEvidenceSnippet(evidence)
  return normalizeCharacterRoleCardProfile({
    personality: buildFacet(
      stringifyLooseValue(record.personality ?? record.personality_traits ?? record.traits),
      stringifyLooseValue(record.personality_note),
      evidenceSnippet,
    ),
    gender: buildFacet(
      stringifyLooseValue(record.gender ?? record.sex),
      stringifyLooseValue(record.gender_note),
      evidenceSnippet,
    ),
    identity: buildFacet(
      stringifyLooseValue(record.identity ?? record.role ?? record.background ?? record.title ?? record.guild_name),
      stringifyLooseValue(record.identity_note ?? record.background_note),
      evidenceSnippet,
    ),
    capability: buildFacet(
      stringifyLooseValue(record.capability ?? record.special_ability ?? record.power ?? record.abilities ?? record.achievements),
      stringifyLooseValue(record.capability_note ?? record.power_note),
      evidenceSnippet,
    ),
    appearance: buildFacet(
      stringifyLooseValue(record.appearance ?? record.looks),
      stringifyLooseValue(record.appearance_note),
      evidenceSnippet,
    ),
    clothing: buildFacet(
      stringifyLooseValue(record.clothing ?? record.outfit ?? record.dress),
      stringifyLooseValue(record.clothing_note),
      evidenceSnippet,
    ),
    speakingStyle: buildFacet(
      stringifyLooseValue(record.speaking_style ?? record.speakingStyle ?? record.voice ?? record.dialogue_style),
      stringifyLooseValue(record.speaking_style_note ?? record.voice_note),
      evidenceSnippet,
    ),
    likes: buildFacet(
      stringifyLooseValue(record.likes ?? record.preferences ?? record.hobbies),
      stringifyLooseValue(record.likes_note ?? record.preferences_note),
      evidenceSnippet,
    ),
  })
}

function isLikelyCharacterCategory(category: string) {
  const normalized = category.trim().toLowerCase()
  return normalized.includes('人物')
    || normalized.includes('角色')
    || normalized.includes('主角')
    || normalized.includes('npc')
}

function normalizeLooseWorldCategory(category: string) {
  if (category.includes('地点') || category.includes('地理')) return 'geography'
  if (category.includes('组织') || category.includes('公会') || category.includes('势力')) return 'politics'
  if (category.includes('规则') || category.includes('职业') || category.includes('能力')) return 'rule'
  if (category.includes('物品') || category.includes('装备') || category.includes('卡牌')) return 'item'
  if (category.includes('历史') || category.includes('时代')) return 'history'
  return 'concept'
}

function buildLooseEventName(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim()
  const head = compact.split(/[，。；：,.!?！？]/)[0]?.trim() ?? ''
  const base = head || compact
  if (base.length <= 24) return base
  return `${base.slice(0, 24).trim()}…`
}

function hasPrimaryExtractionCollections(record: Record<string, unknown>) {
  return Array.isArray(record.characters)
    || Array.isArray(record.entities)
    || Array.isArray(record.relations)
    || Array.isArray(record.events)
    || Array.isArray(record.worldbuilding)
    || Array.isArray(record.open_threads)
    || Array.isArray(record.openThreads)
}

function hasNarrativeProfileFields(record: Record<string, unknown>) {
  return record.main_character !== undefined
    || record.setting !== undefined
    || record.key_locations !== undefined
    || record.key_items !== undefined
    || record.world_status !== undefined
    || record.plot_summary !== undefined
    || record.chapter_content !== undefined
}

function normalizeNarrativeProfileExtraction(record: Record<string, unknown>, chapterNo: number): ChapterKnowledgeExtraction {
  const summary = typeof record.plot_summary === 'string'
    ? record.plot_summary.trim()
    : typeof record.chapter_content === 'string'
      ? record.chapter_content.trim()
      : typeof record.summary === 'string'
        ? record.summary.trim()
        : ''
  const topLevelEvidence = normalizeEvidence(record.evidence)
  const characters: ChapterKnowledgeExtraction['characters'] = []
  const worldbuilding: ChapterKnowledgeExtraction['worldbuilding'] = []
  const events: ChapterKnowledgeExtraction['events'] = []

  const mainCharacter = toRecord(record.main_character)
  if (mainCharacter) {
    const name = typeof mainCharacter.name === 'string' ? mainCharacter.name.trim() : ''
    if (name) {
      const profile = buildProfileFromLooseRecord(mainCharacter, topLevelEvidence)
      characters.push({
        name,
        aliases: [],
        status: '活跃',
        descriptionDelta: buildCharacterDescriptionDelta(profile, stringifyLooseValue(mainCharacter.identity ?? mainCharacter.role)),
        profile,
        evidence: topLevelEvidence,
      })
    }
  }

  const setting = toRecord(record.setting)
  if (setting) {
    const worldName = typeof setting.world_name === 'string' ? setting.world_name.trim() : ''
    const definition = stringifyLooseValue({
      world_type: setting.world_type,
      era_description: setting.era_description,
      current_chapter: setting.current_chapter,
      current_section: setting.current_section,
    })
    if (worldName && definition) {
      worldbuilding.push({
        term: worldName,
        category: 'history',
        definition,
        evidence: topLevelEvidence,
      })
    }
  }

  const worldStatus = toRecord(record.world_status)
  void worldStatus

  if (Array.isArray(record.key_locations)) {
    for (const item of record.key_locations) {
      const term = stringifyLooseValue(item)
      if (!term) continue
      worldbuilding.push({
        term,
        category: 'geography',
        definition: summary || '章节关键地点',
        evidence: topLevelEvidence,
      })
    }
  }

  if (Array.isArray(record.key_items)) {
    for (const item of record.key_items) {
      const term = stringifyLooseValue(item)
      if (!term) continue
      worldbuilding.push({
        term,
        category: 'item',
        definition: summary || '章节关键物品',
        evidence: topLevelEvidence,
      })
    }
  }

  if (summary) {
    events.push({
      name: buildLooseEventName(summary),
      summary,
      eventType: 'story',
      participants: characters.map((character) => ({ name: character.name, role: '主角' })),
      consequences: '',
      importance: 3,
      evidence: topLevelEvidence,
    })
  }

  return {
    chapterNo,
    summary,
    characters,
    relations: [],
    events,
    worldbuilding,
    openThreads: [],
  }
}

function normalizeLooseArrayExtraction(items: unknown[], chapterNo: number): ChapterKnowledgeExtraction {
  const summaryParts: string[] = []
  const characters: ChapterKnowledgeExtraction['characters'] = []
  const worldbuilding: ChapterKnowledgeExtraction['worldbuilding'] = []
  const events: ChapterKnowledgeExtraction['events'] = []

  for (const item of items) {
    const row = toRecord(item)
    if (!row) continue

    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const category = typeof row.entity === 'string'
      ? row.entity.trim()
      : typeof row.type === 'string'
        ? row.type.trim()
        : typeof row.category === 'string'
          ? row.category.trim()
          : ''
    const evidence = normalizeEvidence(row.evidence)
    const description = typeof row.description === 'string'
      ? row.description.trim()
      : typeof row.summary === 'string'
        ? row.summary.trim()
        : typeof row.content === 'string'
          ? row.content.trim()
          : stringifyLooseValue(row.attributes)

    if (description) {
      summaryParts.push(description)
    }

    if (!name) {
      if (description) {
        events.push({
          name: buildLooseEventName(description),
          summary: description,
          eventType: 'story',
          participants: [],
          consequences: '',
          importance: 3,
          evidence,
        })
      }
      continue
    }

    if (!description) {
      continue
    }

    if (isLikelyCharacterCategory(category)) {
      const profile = buildProfileFromLooseRecord(row, evidence)
      characters.push({
        name,
        aliases: [],
        status: typeof row.status === 'string' ? row.status.trim() : '活跃',
        descriptionDelta: buildCharacterDescriptionDelta(profile, description),
        profile,
        evidence,
      })
      continue
    }

    worldbuilding.push({
      term: name,
      category: normalizeLooseWorldCategory(category),
      definition: description,
      evidence,
    })
  }

  return {
    chapterNo,
    summary: summaryParts.join(' ').trim(),
    characters,
    relations: [],
    events,
    worldbuilding,
    openThreads: [],
  }
}

export function normalizeKnowledgeExtraction(raw: unknown, chapterNo: number): ChapterKnowledgeExtraction {
  if (Array.isArray(raw)) {
    const records = raw
      .map((item) => toRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))

    const structuredRoot = records
      .find((item) => item && (
        Array.isArray(item.characters)
        || Array.isArray(item.entities)
        || Array.isArray(item.relations)
        || Array.isArray(item.events)
        || Array.isArray(item.worldbuilding)
        || Array.isArray(item.open_threads)
        || Array.isArray(item.openThreads)
      ))

    if (structuredRoot) {
      return normalizeKnowledgeExtraction(structuredRoot, chapterNo)
    }

    const narrativeRoot = records.find((item) => hasNarrativeProfileFields(item))
    if (narrativeRoot) {
      return normalizeNarrativeProfileExtraction(narrativeRoot, chapterNo)
    }

    return normalizeLooseArrayExtraction(raw, chapterNo)
  }

  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (!hasPrimaryExtractionCollections(record)) {
    if (hasNarrativeProfileFields(record)) {
      return normalizeNarrativeProfileExtraction(record, chapterNo)
    }
  }

  const openThreadsRaw = record.open_threads ?? record.openThreads
  const charactersRaw = Array.isArray(record.characters)
    ? record.characters
    : Array.isArray(record.entities)
      ? record.entities
      : []
  return {
    chapterNo,
    summary: typeof record.summary === 'string'
      ? record.summary.trim()
      : typeof record.content_summary === 'string'
        ? record.content_summary.trim()
        : typeof record.contentSummary === 'string'
          ? record.contentSummary.trim()
          : typeof record.content === 'string'
            ? record.content.trim()
          : '',
    characters: Array.isArray(charactersRaw)
      ? charactersRaw
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const name = typeof row.name === 'string' ? row.name.trim() : ''
            if (!name) return null
            const evidence = normalizeEvidence(row.evidence)
            const profileRecord = row.profile && typeof row.profile === 'object' && !Array.isArray(row.profile)
              ? row.profile as Record<string, unknown>
              : {}
            const profile = normalizeCharacterRoleCardProfile({
              personality: normasecondSampleProfileFacet(profileRecord.personality ?? row.personality),
              gender: normasecondSampleProfileFacet(profileRecord.gender ?? row.gender),
              identity: normasecondSampleProfileFacet(profileRecord.identity ?? row.identity),
              capability: normasecondSampleProfileFacet(profileRecord.capability ?? row.capability),
              appearance: normasecondSampleProfileFacet(profileRecord.appearance ?? row.appearance),
              clothing: normasecondSampleProfileFacet(profileRecord.clothing ?? row.clothing),
              speakingStyle: normasecondSampleProfileFacet(profileRecord.speakingStyle ?? row.speaking_style ?? row.speakingStyle),
              likes: normasecondSampleProfileFacet(profileRecord.likes ?? row.likes),
            })
            const looseProfile = buildProfileFromLooseRecord(row, evidence)
            const finalProfile = normalizeCharacterRoleCardProfile({ ...looseProfile, ...profile })
            return {
              name,
              aliases: Array.isArray(row.aliases) ? row.aliases.map((alias) => String(alias).trim()).filter(Boolean) : [],
              status: typeof row.status === 'string' ? row.status.trim() : '活跃',
              descriptionDelta: typeof row.description_delta === 'string'
                ? row.description_delta.trim()
                : typeof row.descriptionDelta === 'string'
                  ? row.descriptionDelta.trim()
                  : typeof row.description === 'string'
                    ? row.description.trim()
                  : buildCharacterDescriptionDelta(finalProfile),
              profile: finalProfile,
              evidence,
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['characters'][number] => Boolean(item))
      : [],
    relations: Array.isArray(record.relations)
      ? record.relations
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const source = typeof row.source === 'string' ? row.source.trim() : ''
            const target = typeof row.target === 'string' ? row.target.trim() : ''
            if (!source || !target) return null
            const relationType = normalizeRelationType(row.type ?? row.link_type ?? row.linkType, row.label)
            if (!relationType) return null
            const polarity = typeof row.polarity === 'string' ? row.polarity : 'neutral'
            return {
              source,
              target,
              type: relationType,
              polarity: ['positive', 'negative', 'neutral', 'mixed'].includes(polarity) ? polarity as 'positive' | 'negative' | 'neutral' | 'mixed' : 'neutral',
              strength: Number.isFinite(Number(row.strength)) ? Math.max(1, Math.min(5, Math.trunc(Number(row.strength)))) : 3,
              change: typeof row.change === 'string' ? row.change.trim() : '',
              validFromChapter: Number.isFinite(Number(row.valid_from_chapter ?? row.validFromChapter))
                ? Math.max(1, Math.trunc(Number(row.valid_from_chapter ?? row.validFromChapter)))
                : chapterNo,
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['relations'][number] => Boolean(item))
      : [],
    events: Array.isArray(record.events)
      ? record.events
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const name = typeof row.name === 'string' ? row.name.trim() : ''
            if (!name) return null
            const participants = Array.isArray(row.participants)
              ? row.participants
                  .map((participant) => {
                    if (!participant || typeof participant !== 'object') return null
                    const entry = participant as Record<string, unknown>
                    const participantName = typeof entry.name === 'string' ? entry.name.trim() : ''
                    if (!participantName) return null
                    return {
                      name: participantName,
                      role: typeof entry.role === 'string' ? entry.role.trim() : '参与者',
                    }
                  })
                  .filter((entry): entry is { name: string; role: string } => Boolean(entry))
              : []
            return {
              name,
              summary: typeof row.summary === 'string' ? row.summary.trim() : '',
              eventType: typeof row.event_type === 'string'
                ? row.event_type.trim()
                : typeof row.eventType === 'string'
                  ? row.eventType.trim()
                  : 'story',
              participants,
              consequences: typeof row.consequences === 'string' ? row.consequences.trim() : '',
              importance: Number.isFinite(Number(row.importance)) ? Math.max(1, Math.min(5, Math.trunc(Number(row.importance)))) : 3,
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['events'][number] => Boolean(item))
      : [],
    worldbuilding: Array.isArray(record.worldbuilding)
      ? record.worldbuilding
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const term = typeof row.term === 'string' ? row.term.trim() : ''
            const definition = typeof row.definition === 'string' ? row.definition.trim() : ''
            if (!term || !definition || isGenericWorldTerm(term)) return null
            return {
              term,
              category: typeof row.category === 'string' ? normalizeWorldCategory(row.category) : 'concept',
              definition,
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['worldbuilding'][number] => Boolean(item))
      : [],
    openThreads: Array.isArray(openThreadsRaw)
      ? openThreadsRaw
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const name = typeof row.name === 'string' ? row.name.trim() : ''
            if (!name) return null
            return {
              name,
              description: typeof row.description === 'string' ? row.description.trim() : '',
              evidence: normalizeEvidence(row.evidence),
            }
          })
          .filter((item): item is ChapterKnowledgeExtraction['openThreads'][number] => Boolean(item))
      : [],
  }
}

function getStoredOllamaTimeout() {
  const timeoutEntry = findAppSettings(['OLLAMA_TIMEOUT_MS'])[0]?.value
  return parsePositiveInt(timeoutEntry ?? process.env.OLLAMA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
}

function getStoredOllamaSettings(scenario: AIScenarioKey = 'knowledgeExtraction') {
  const settings = loadStoredAISettings()[scenario].ollama
  return {
    baseUrl: settings.baseUrl.trim() || DEFAULT_BASE_URL,
    model: settings.model.trim(),
    timeoutMs: getStoredOllamaTimeout(),
  }
}

async function fetchOllamaTags(baseUrl: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { cache: 'no-store' })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  return await response.json() as OllamaTagsResponse
}

async function fetchOllamaCapabilities(baseUrl: string, model: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    cache: 'no-store',
  })

  if (!response.ok) {
    return [] as string[]
  }

  const data = await response.json() as OllamaShowResponse
  return data.capabilities ?? []
}

async function listAvailableOllamaModels(
  baseUrlOverride?: string,
  purpose: 'text' | 'embedding' = 'text'
): Promise<{ baseUrl: string; models: OllamaModelOption[] }> {
  const stored = getStoredOllamaSettings(purpose === 'embedding' ? 'embeddings' : 'knowledgeExtraction')
  const baseUrl = (baseUrlOverride?.trim() || stored.baseUrl).replace(/\/$/, '')
  const tags = await fetchOllamaTags(baseUrl)
  const candidates = (tags.models ?? [])
    .map((item) => ({
      id: (item.model ?? item.name ?? '').trim(),
      name: (item.name ?? item.model ?? '').trim(),
      modifiedAt: item.modified_at,
      sizeBytes: item.size,
      family: item.details?.family,
      parameterSize: item.details?.parameter_size,
      quantization: item.details?.quantization_level,
    }))
    .filter((item) => item.id)

  const capabilityResults = await Promise.all(
    candidates.map(async (item) => ({
      item,
      capabilities: await fetchOllamaCapabilities(baseUrl, item.id),
    }))
  )

  const models = capabilityResults
    .filter(({ item, capabilities }) => {
      if (capabilities.length > 0) {
        return purpose === 'embedding'
          ? capabilities.includes('embedding')
          : capabilities.includes('completion')
      }
      return purpose === 'embedding' ? /embed/i.test(item.id) : !/embed/i.test(item.id)
    })
    .map(({ item }) => ({
      id: item.id,
      label: [item.name, [item.parameterSize, item.quantization].filter(Boolean).join(' · ')].filter(Boolean).join(' — '),
      family: item.family,
      parameterSize: item.parameterSize,
      quantization: item.quantization,
      sizeBytes: item.sizeBytes,
      modifiedAt: item.modifiedAt,
    }))

  return { baseUrl, models }
}

export async function listAvailableOllamaTextModels(baseUrlOverride?: string): Promise<{ baseUrl: string; models: OllamaModelOption[] }> {
  return listAvailableOllamaModels(baseUrlOverride, 'text')
}

export async function listAvailableOllamaEmbeddingModels(baseUrlOverride?: string): Promise<{ baseUrl: string; models: OllamaModelOption[] }> {
  return listAvailableOllamaModels(baseUrlOverride, 'embedding')
}

async function resolveOllamaTextConfig(
  baseUrl: string,
  timeoutMs: number,
  configuredModel: string | null | undefined,
  emptyReason: string
): Promise<OllamaConfig> {

  let detectedModels: string[] = []
  try {
    const data = await fetchOllamaTags(baseUrl)
    detectedModels = (data.models ?? []).map((item) => (item.model ?? item.name ?? '').trim()).filter(Boolean)
  } catch {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: 'Ollama local server is not reachable',
    }
  }

  const preferredModel = configuredModel || detectedModels.find((name) => !/embed/i.test(name)) || null
  if (!preferredModel) {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: emptyReason,
    }
  }

  if (/embed/i.test(preferredModel)) {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: `Configured Ollama model '${preferredModel}' is an embedding model`,
    }
  }

  return {
    baseUrl,
    model: preferredModel,
    timeoutMs,
    enabled: true,
  }
}

async function getOllamaExtractionConfig(configOverride?: Partial<OllamaProviderSettings>): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings('knowledgeExtraction')
  return resolveOllamaTextConfig(
    configOverride?.baseUrl?.trim() || stored.baseUrl,
    stored.timeoutMs,
    configOverride?.model ?? stored.model,
    'No local Ollama text generation model found'
  )
}

async function getOllamaRewriteConfig(configOverride?: Partial<OllamaProviderSettings>): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings('rewrite')
  return resolveOllamaTextConfig(
    configOverride?.baseUrl?.trim() || stored.baseUrl,
    stored.timeoutMs,
    configOverride?.model ?? stored.model,
    'No local Ollama rewrite model found'
  )
}

async function getOllamaEmbeddingConfig(configOverride?: Partial<OllamaProviderSettings>): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings('embeddings')
  const baseUrl = configOverride?.baseUrl?.trim() || stored.baseUrl
  const timeoutMs = stored.timeoutMs

  let detectedModels: OllamaModelOption[] = []
  try {
    const available = await listAvailableOllamaEmbeddingModels(baseUrl)
    detectedModels = available.models
  } catch {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: 'Ollama local server is not reachable',
    }
  }

  const configuredModel = (configOverride?.model ?? stored.model).trim()
  const preferredModel = configuredModel || detectedModels[0]?.id || null
  if (!preferredModel) {
    return {
      baseUrl,
      model: null,
      timeoutMs,
      enabled: false,
      reason: 'No local Ollama embedding model found',
    }
  }

  return {
    baseUrl,
    model: preferredModel,
    timeoutMs,
    enabled: true,
  }
}

export async function embedTextsWithOllama(
  input: string | string[],
  configOverride?: Partial<OllamaProviderSettings>
): Promise<OllamaEmbeddingResult> {
  const config = await getOllamaEmbeddingConfig(configOverride)
  if (!config.enabled || !config.model) {
    return {
      enabled: false,
      error: config.reason,
    }
  }

  const normalizedInput = (Array.isArray(input) ? input : [input])
    .map((item) => item.trim())
    .filter(Boolean)

  if (!normalizedInput.length) {
    return {
      enabled: true,
      embeddings: [],
      model: config.model,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const requestBody = {
    model: config.model,
    input: Array.isArray(input) ? normalizedInput : normalizedInput[0],
    truncate: true,
  }

  try {
    let response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (response.status === 404) {
      response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        cache: 'no-store',
        signal: controller.signal,
      })
    }

    if (!response.ok) {
      const text = await response.text()
      return {
        enabled: false,
        model: config.model,
        error: `Ollama embedding HTTP ${response.status}: ${text.slice(0, 200)}`,
      }
    }

    const data = await response.json() as OllamaEmbedResponse & { embedding?: number[] }
    const embeddings = Array.isArray(data.embeddings)
      ? data.embeddings
      : Array.isArray(data.embedding)
        ? [data.embedding]
        : []

    const validEmbeddings = embeddings.filter(
      (vector): vector is number[] => Array.isArray(vector) && vector.length > 0 && vector.every((value) => Number.isFinite(value))
    )

    if (!validEmbeddings.length) {
      return {
        enabled: false,
        model: config.model,
        error: 'Ollama embedding response did not contain usable vectors',
      }
    }

    return {
      enabled: true,
      embeddings: validEmbeddings,
      model: data.model ?? config.model,
    }
  } catch (error) {
    return {
      enabled: false,
      model: config.model,
      error: error instanceof Error ? error.message : 'Failed to generate embeddings with Ollama',
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function buildKnowledgeExtractionPrompt(
  chapterTitle: string,
  chapterNo: number,
  rawText: string,
   mode: KnowledgeExtractionPromptMode = 'full',
   storyStateText?: string
) {
  const sourceLines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const truncated = sourceLines.length > EXTRACTION_MAX_PROMPT_LINES
  const excerptLines = truncated ? sourceLines.slice(0, EXTRACTION_MAX_PROMPT_LINES) : sourceLines
  const numberedLines = excerptLines
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')
  const normalizedStoryStateText = storyStateText?.trim() ?? ''
  const storyStateBlock = normalizedStoryStateText
    ? ['已知前情故事状态（仅截至上一章，不包含本章）：', normalizedStoryStateText].join('\n\n')
    : ''
  const storyStateRules = normalizedStoryStateText
    ? [
        '若本章提到已知人物的公开名、别名、称呼，优先按前情中的已有角色理解。',
        '“他 / 她 / 它 / 那人 / 这人 / 对方”等代词或泛称不得直接当作新人物名。',
        '如果无法根据本章证据或前情中的已有别名唯一定位人物，就不要把它写成新的 characters 条目。',
      ]
    : []

  if (mode === 'focused') {
      return [
        `任务：只基于第 ${chapterNo} 章内容，补充抽取人物关系、世界设定和未解决线索。`,
      '只返回 1 个 JSON 对象。不要返回顶层数组。不要解释。不要输出 markdown。',
      '固定字段只能是：chapter_no、summary、characters、relations、events、worldbuilding、open_threads。',
      '本轮重点只抽取 relations、worldbuilding、open_threads。summary 可以简短；characters 和 events 若无必要一律返回空数组。',
      '结果必须精确、精简、可验证。不要把泛泛背景写成设定，不要把弱暗示写成关系，不要编造。',
      ...storyStateRules,
      'relations.type 必须是具体语义，不要输出“关系”“联系”“有关联”“相关”等泛化词。优先使用“同盟”“敌对”“同行”“救助”“雇佣”“师徒”“亲属”“隶属”“交易”“合作”等具体类型。',
      'worldbuilding 只保留可复用的稳定设定、规则、地点、组织或物品。不要把“世界状态”“本章背景”或一次性剧情描写写成设定。definition 控制在一句话内。',
      'evidence 字段固定使用 quote、line_start、line_end。不要使用 text、content 或其他字段名。',
      truncated ? `本次仅提供前 ${EXTRACTION_MAX_PROMPT_LINES} 行节选。不要猜测未提供的后续内容。` : '本次提供完整章节内容。',
      '最小示例：',
      '{"chapter_no":1,"summary":"","characters":[],"relations":[{"source":"甲","target":"乙","type":"同伴","polarity":"positive","strength":3,"change":"合作开始","valid_from_chapter":1,"evidence":[{"quote":"甲与乙决定同行。","line_start":3,"line_end":3}]}],"events":[],"worldbuilding":[{"term":"黑塔","category":"organization","definition":"一座负责训练学徒的组织。","evidence":[{"quote":"黑塔每年招收学徒。","line_start":8,"line_end":8}]}],"open_threads":[{"name":"失踪的导师","description":"导师去向未明，后续仍需解释。","evidence":[{"quote":"导师至今没有回来。","line_start":12,"line_end":12}]}]}',
      storyStateBlock,
      `章节标题：${chapterTitle}`,
      '章节正文（带行号）：',
      numberedLines,
    ].join('\n\n')
  }

  return [
    `任务：只基于第 ${chapterNo} 章内容抽取结构化知识。`,
    '只返回 1 个 JSON 对象。不要返回顶层数组。不要解释。不要输出 markdown。',
    '固定字段只能是：chapter_no、summary、characters、relations、events、worldbuilding、open_threads。',
    '如果某一类无法确定，就返回空数组，不要编造。',
    ...storyStateRules,
    'characters.profile 必须是精简的人物角色卡。只保留文本中能直接支持的要点；不要写成长段；不确定就省略该字段。',
    'characters.profile 可包含：personality、gender、identity、capability、appearance、clothing、speakingStyle、likes。每个字段都是 { summary, note?, evidence? }；summary 最多一句短语，note/evidence 仅在有必要时填写。',
    '优先抽取身份背景、能力/战力、外形、衣着、说话风格与偏好，保持精确、克制、可用于后续人物扮演。',
    'evidence 字段固定使用 quote、line_start、line_end。不要使用 text、content 或其他字段名。',
    truncated ? `本次仅提供前 ${EXTRACTION_MAX_PROMPT_LINES} 行节选。不要猜测未提供的后续内容。` : '本次提供完整章节内容。',
    '最小示例：',
    '{"chapter_no":1,"summary":"一句话总结","characters":[{"name":"林澄","aliases":[],"status":"活跃","description_delta":"没落家族出身的学徒｜擅长火系法术","profile":{"identity":{"summary":"没落家族出身的学徒"},"capability":{"summary":"擅长火系法术"},"speakingStyle":{"summary":"说话直接克制","evidence":"林澄压低声音，只说重点。"}},"evidence":[{"quote":"林澄压低声音，只说重点。","line_start":1,"line_end":1}]}],"relations":[],"events":[],"worldbuilding":[],"open_threads":[]}',
    storyStateBlock,
    `章节标题：${chapterTitle}`,
    '章节正文（带行号）：',
    numberedLines,
  ].join('\n\n')
}

function extractFirstJsonCandidate(content: string) {
  const trimmed = content.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]?.trim()) {
    return extractFirstJsonCandidate(fencedMatch[1].trim())
  }

  const firstBrace = trimmed.indexOf('{')
  const firstBracket = trimmed.indexOf('[')
  const startIndexes = [firstBrace, firstBracket].filter((index) => index >= 0)
  const startIndex = startIndexes.length ? Math.min(...startIndexes) : -1

  if (startIndex >= 0) {
    const stack: Array<'{' | '['> = []
    let inString = false
    let escaped = false

    for (let index = startIndex; index < trimmed.length; index += 1) {
      const char = trimmed[index]

      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }

        if (char === '\\') {
          escaped = true
          continue
        }

        if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === '{' || char === '[') {
        stack.push(char)
        continue
      }

      if (char === '}' && stack.at(-1) === '{') {
        stack.pop()
      } else if (char === ']' && stack.at(-1) === '[') {
        stack.pop()
      }

      if (!stack.length) {
        return trimmed.slice(startIndex, index + 1).trim()
      }
    }

    return trimmed.slice(startIndex).trim()
  }

  return trimmed
}

function collectTopLevelJsonCandidates(content: string) {
  const candidates: string[] = []
  const trimmed = content.trim()
  if (!trimmed) return candidates

  let startIndex = -1
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      if (startIndex < 0) {
        startIndex = index
      }
      stack.push(char)
      continue
    }

    if (char === '}' || char === ']') {
      if (!stack.length) {
        continue
      }

      const expectedOpen = char === '}' ? '{' : '['
      if (stack.at(-1) !== expectedOpen) {
        continue
      }

      stack.pop()
      if (!stack.length && startIndex >= 0) {
        candidates.push(trimmed.slice(startIndex, index + 1).trim())
        startIndex = -1
      }
    }
  }

  return candidates
}

function extractJsonCandidates(content: string) {
  const trimmed = content.trim()
  if (!trimmed) return [] as string[]

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const sources = [fencedMatch?.[1]?.trim(), trimmed].filter((value): value is string => Boolean(value))
  const candidates: string[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    const extracted = collectTopLevelJsonCandidates(source)
    const nextCandidates = extracted.length ? extracted : [extractFirstJsonCandidate(source)]
    for (const candidate of nextCandidates) {
      const normalized = candidate.trim()
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      candidates.push(normalized)
    }
  }

  return candidates
}

function getJsonStructureStack(content: string, limit = content.length) {
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false

  for (let index = 0; index < Math.min(limit, content.length); index += 1) {
    const char = content[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }

    if (char === '}' && stack.at(-1) === '{') {
      stack.pop()
      continue
    }

    if (char === ']' && stack.at(-1) === '[') {
      stack.pop()
    }
  }

  return stack
}

function closeContainers(chars: Array<'{' | '['>) {
  return chars
    .slice()
    .reverse()
    .map((char) => (char === '{' ? '}' : ']'))
    .join('')
}

function repairMismatchedClosers(content: string) {
  let repaired = ''
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false

  for (const char of content) {
    if (inString) {
      repaired += char
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      repaired += char
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      repaired += char
      continue
    }

    if (char === '}' || char === ']') {
      const expectedOpen = char === '}' ? '{' : '['
      while (stack.length > 0 && stack.at(-1) !== expectedOpen) {
        const current = stack.pop()
        repaired += current === '{' ? '}' : ']'
      }

      if (stack.at(-1) === expectedOpen) {
        stack.pop()
      }

      repaired += char
      continue
    }

    repaired += char
  }

  return repaired
}

function repairTopLevelBoundaries(content: string) {
  let repaired = content

  for (const key of EXTRACTION_TOP_LEVEL_ARRAY_KEYS) {
    const marker = `,\"${key}\":`
    const markerIndex = repaired.indexOf(marker)
    if (markerIndex < 0) continue

    const stack = getJsonStructureStack(repaired, markerIndex)
    if (stack.length <= 1) continue

    repaired = `${repaired.slice(0, markerIndex)}${closeContainers(stack.slice(1))}${repaired.slice(markerIndex)}`
  }

  return repaired
}

export function parseKnowledgeExtractionCandidates(content: string) {
  const candidates = extractJsonCandidates(content)
  let lastError: unknown = new Error('Failed to parse Ollama JSON')
  const parsedCandidates: unknown[] = []
  const seenVariants = new Set<string>()

  for (const candidate of candidates) {
    const boundaryRepaired = repairTopLevelBoundaries(candidate)
    const closerRepaired = repairMismatchedClosers(boundaryRepaired)
    const completed = `${closerRepaired}${closeContainers(getJsonStructureStack(closerRepaired))}`
    const variants = [candidate]
    if (completed !== candidate) {
      variants.push(completed)
    }

    for (const variant of variants) {
      if (seenVariants.has(variant)) continue
      seenVariants.add(variant)

      try {
        parsedCandidates.push(JSON.parse(variant))
      } catch (error) {
        lastError = error
      }
    }
  }

  if (parsedCandidates.length) {
    return parsedCandidates
  }

  throw lastError
}

function parseStructuredContent(content: string) {
  const [firstCandidate] = parseKnowledgeExtractionCandidates(content)
  if (firstCandidate === undefined) {
    throw new Error('Failed to parse Ollama JSON')
  }
  return firstCandidate
}

export function hasUsableKnowledgeExtraction(
  extraction: ChapterKnowledgeExtraction,
  mode: KnowledgeExtractionPromptMode = 'full'
) {
  const hasSpecificRelation = extraction.relations.some((relation) => !looksGenericRelationType(relation.type))
  const hasUsefulWorldbuilding = extraction.worldbuilding.some((entry) => entry.term.trim() && entry.definition.trim() && !isGenericWorldTerm(entry.term))

  if (mode === 'focused') {
    return hasSpecificRelation
      || hasUsefulWorldbuilding
      || extraction.openThreads.length > 0
  }

  return extraction.characters.length > 0
    || hasSpecificRelation
    || extraction.events.length > 0
    || hasUsefulWorldbuilding
    || extraction.openThreads.length > 0
}

async function requestStructuredExtraction(params: {
  baseUrl: string
  model: string
  prompt: string
  timeoutMs: number
  repairMessage?: string
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        think: false,
        format: EXTRACTION_SCHEMA,
        keep_alive: '5m',
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: 'Return exactly one valid JSON object for chapter knowledge. Never return a top-level array. Never output markdown or commentary.',
          },
          {
            role: 'user',
            content: params.repairMessage ? `${params.prompt}\n\n修复要求：${params.repairMessage}` : params.prompt,
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 400)}`)
    }

    return await response.json() as OllamaChatResponse
  } finally {
    clearTimeout(timeout)
  }
}

async function requestStructuredRepair(params: {
  baseUrl: string
  model: string
  invalidContent: string
  timeoutMs: number
  errorMessage: string
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        think: false,
        format: EXTRACTION_SCHEMA,
        keep_alive: '5m',
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: 'Repair malformed JSON into exactly one valid JSON object that matches the requested chapter-knowledge shape. Never return a top-level array. Do not add commentary or markdown.',
          },
          {
            role: 'user',
            content: [
              '下面是一段本地模型生成的无效 JSON，请只修复 JSON 结构问题。',
              '请只返回与当前请求格式完全匹配的 JSON 对象。',
              '不要补充原文中不存在的事实，不要输出解释。',
              `解析错误：${params.errorMessage}`,
              '无效 JSON：',
              params.invalidContent,
            ].join('\n\n'),
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 400)}`)
    }

    return await response.json() as OllamaChatResponse
  } finally {
    clearTimeout(timeout)
  }
}

export async function extractChapterKnowledgeWithOllama(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  storyStateText?: string
  mode?: KnowledgeExtractionPromptMode
}, configOverride?: Partial<OllamaProviderSettings>): Promise<OllamaExtractionResult> {
  const config = await getOllamaExtractionConfig(configOverride)
  if (!config.enabled || !config.model) {
    return {
      enabled: false,
      error: config.reason ?? 'Ollama extraction disabled',
    }
  }

  const mode = params.mode ?? 'full'
  const prompt = buildKnowledgeExtractionPrompt(
    params.chapterTitle,
    params.chapterNo,
    params.rawText,
    mode,
    params.storyStateText,
  )
  let lastError = 'Failed to parse Ollama JSON'
  let lastContent = ''

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = attempt === 0
        ? await requestStructuredExtraction({
            baseUrl: config.baseUrl,
            model: config.model,
            prompt,
            timeoutMs: config.timeoutMs,
          })
        : await requestStructuredRepair({
            baseUrl: config.baseUrl,
            model: config.model,
            invalidContent: lastContent,
            timeoutMs: config.timeoutMs,
            errorMessage: lastError,
          })

      const content = response.message?.content?.trim() ?? ''
      lastContent = content
      if (!content) {
        lastError = 'Ollama returned empty content'
        continue
      }

      const parsedCandidates = parseKnowledgeExtractionCandidates(content)
      for (const parsed of parsedCandidates) {
        const extraction = normalizeKnowledgeExtraction(parsed, params.chapterNo)
        if (hasUsableKnowledgeExtraction(extraction, mode)) {
          return {
            enabled: true,
            model: config.model,
            extraction,
          }
        }
      }

      lastError = 'Ollama returned parseable JSON but no usable knowledge'
      console.error('Ollama extraction returned no usable knowledge', {
        chapterTitle: params.chapterTitle,
        chapterNo: params.chapterNo,
        model: config.model,
        rawOutput: content,
      })
      if (attempt === 0) {
        continue
      }

      break
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Ollama extraction failed'
      if (lastContent) {
        console.error('Ollama JSON parse failed', {
          chapterTitle: params.chapterTitle,
          chapterNo: params.chapterNo,
          model: config.model,
          error: lastError,
          rawOutput: lastContent,
        })
      }
    }
  }

  return {
    enabled: true,
    model: config.model,
    error: lastError,
  }
}

function buildOllamaChatRequestBody(params: {
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  temperature?: number
  format?: unknown
  stream: boolean
}) {
  return {
    model: params.model,
    stream: params.stream,
    think: false,
    keep_alive: '5m',
    format: params.format,
    options: {
      temperature: params.temperature ?? 0.7,
    },
    messages: params.messages,
  }
}

async function requestOllamaChat(params: {
  baseUrl: string
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  timeoutMs: number
  temperature?: number
  format?: unknown
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOllamaChatRequestBody({ ...params, stream: false })),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 400)}`)
    }

    return await response.json() as OllamaChatResponse
  } finally {
    clearTimeout(timeout)
  }
}

async function requestOllamaChatStream(params: {
  baseUrl: string
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  timeoutMs: number
  temperature?: number
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOllamaChatRequestBody({ ...params, stream: true })),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 400)}`)
    }

    if (!response.body) {
      throw new Error('No response body returned from Ollama')
    }

    return response.body
  } finally {
    clearTimeout(timeout)
  }
}

export async function generateRewriteWithOllama(
  input: OllamaRewriteRequest,
  configOverride?: Partial<OllamaProviderSettings>
): Promise<OllamaRewriteResult> {
  const config = await getOllamaRewriteConfig(configOverride)
  if (!config.enabled || !config.model) {
    return { enabled: false, error: config.reason ?? 'Ollama rewrite config not set' }
  }

  const user = {
    task: 'rewrite',
    mode: input.mode,
    tone: input.tone,
    scope: input.scope,
    keepCanon: input.keepCanon,
    autoContinue: input.autoContinue,
    thoughtLevel: input.thoughtLevel,
    prompt: input.prompt,
    sourceText: input.sourceText,
    outputSchema: {
      candidates: ['candidate 1 text', 'candidate 2 text', 'candidate 3 text'],
    },
  }

  try {
    const response = await requestOllamaChat({
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: Math.min(config.timeoutMs, 30000),
      temperature: input.tone === 'keep' ? 0.7 : 0.9,
      format: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: { type: 'string' },
            minItems: 3,
            maxItems: 3,
          },
        },
        required: ['candidates'],
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are a novel rewriting assistant.',
            'Return JSON only.',
            'Produce exactly 3 rewrite candidates in Chinese.',
            'Each candidate should be a coherent prose passage.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify(user) },
      ],
    })

    const raw = response.message?.content?.trim() ?? ''
    if (!raw) {
      return { enabled: true, error: 'No content returned from model' }
    }

    const parsed = parseStructuredContent(raw) as { candidates?: unknown[] }
    const candidates = Array.isArray(parsed.candidates)
      ? parsed.candidates.map((item) => String(item)).filter(Boolean).slice(0, 3)
      : []
    if (!candidates.length) {
      return { enabled: true, error: 'Model returned empty candidates' }
    }

    return { enabled: true, content: candidates }
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : 'Ollama rewrite failed',
    }
  }
}

export async function streamRewriteWithOllama(
  input: OllamaStreamRewriteRequest,
  configOverride?: Partial<OllamaProviderSettings>
): Promise<OllamaStreamRewriteResult> {
  const config = await getOllamaRewriteConfig(configOverride)
  if (!config.enabled || !config.model) {
    return { enabled: false, error: config.reason ?? 'Ollama rewrite config not set' }
  }

  try {
    const upstream = await requestOllamaChatStream({
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
      temperature: input.temperature ?? 0.7,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    })

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const reader = upstream.getReader()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = ''
        let sawContent = false
        let finished = false

        const flushLine = (line: string) => {
          const trimmed = line.trim()
          if (!trimmed) return

          let parsed: OllamaChatStreamChunk
          try {
            parsed = JSON.parse(trimmed) as OllamaChatStreamChunk
          } catch {
            return
          }

          if (parsed.error) {
            controller.error(new Error(parsed.error))
            finished = true
            return
          }

          const content = parsed.message?.content ?? ''
          if (content) {
            sawContent = true
            controller.enqueue(encoder.encode(content))
          }

          if (parsed.done) {
            finished = true
          }
        }

        try {
          while (!finished) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              flushLine(line)
              if (finished) break
            }
          }

          if (!finished && buffer.trim()) {
            flushLine(buffer)
          }
        } catch (error) {
          controller.error(error)
          return
        } finally {
          try {
            await reader.cancel()
          } catch {
          }
        }

        if (!sawContent) {
          controller.error(new Error('No content returned from model'))
          return
        }

        controller.close()
      },
    })

    return {
      enabled: true,
      stream,
    }
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : 'Ollama rewrite failed',
    }
  }
}
