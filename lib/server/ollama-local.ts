import type { ChapterKnowledgeExtraction, KnowledgeEvidence } from '@/lib/story-knowledge'
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

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_TIMEOUT_MS = 600000
const EXTRACTION_TOP_LEVEL_ARRAY_KEYS = ['relations', 'events', 'worldbuilding', 'open_threads'] as const
const EXTRACTION_MAX_PROMPT_LINES = 60
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
        required: ['name', 'aliases', 'status', 'description_delta', 'evidence'],
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
      characters.push({
        name,
        aliases: [],
        status: '活跃',
        descriptionDelta: stringifyLooseValue({
          role: mainCharacter.role,
          guild_name: mainCharacter.guild_name,
          title: mainCharacter.title,
          identity: mainCharacter.identity,
          special_ability: mainCharacter.special_ability,
          achievements: mainCharacter.achievements,
          appearance: mainCharacter.appearance,
          personality_traits: mainCharacter.personality_traits,
        }),
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
  if (worldStatus) {
    const definition = stringifyLooseValue(worldStatus)
    if (definition) {
      worldbuilding.push({
        term: '世界状态',
        category: 'history',
        definition,
        evidence: topLevelEvidence,
      })
    }
  }

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

    if (isLikelyCharacterCategory(category)) {
      characters.push({
        name,
        aliases: [],
        status: typeof row.status === 'string' ? row.status.trim() : '活跃',
        descriptionDelta: description,
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
                  : '',
              evidence: normalizeEvidence(row.evidence),
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
            const polarity = typeof row.polarity === 'string' ? row.polarity : 'neutral'
            return {
              source,
              target,
              type: typeof row.type === 'string' ? row.type.trim() : '关系',
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
            if (!term) return null
            return {
              term,
              category: typeof row.category === 'string' ? row.category.trim() : 'concept',
              definition: typeof row.definition === 'string' ? row.definition.trim() : '',
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

function getStoredOllamaSettings() {
  const entries = findAppSettings([
    'OLLAMA_BASE_URL',
    'OLLAMA_REWRITE_MODEL',
    'OLLAMA_MODEL',
    'OLLAMA_EMBEDDING_MODEL',
    'OLLAMA_TIMEOUT_MS',
  ])
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value]))
  return {
    baseUrl: map.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL,
    rewriteModel: (map.OLLAMA_REWRITE_MODEL ?? process.env.OLLAMA_REWRITE_MODEL ?? '').trim(),
    model: (map.OLLAMA_MODEL ?? process.env.OLLAMA_MODEL ?? '').trim(),
    embeddingModel: (map.OLLAMA_EMBEDDING_MODEL ?? process.env.OLLAMA_EMBEDDING_MODEL ?? '').trim(),
    timeoutMs: parsePositiveInt(map.OLLAMA_TIMEOUT_MS ?? process.env.OLLAMA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
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
  const stored = getStoredOllamaSettings()
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

async function resolveOllamaTextConfig(configuredModel: string | null | undefined, emptyReason: string): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings()
  const baseUrl = stored.baseUrl
  const timeoutMs = stored.timeoutMs

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

async function getOllamaExtractionConfig(): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings()
  return resolveOllamaTextConfig(stored.model, 'No local Ollama text generation model found')
}

async function getOllamaRewriteConfig(): Promise<OllamaConfig> {
  const stored = getStoredOllamaSettings()
  return resolveOllamaTextConfig(stored.rewriteModel, 'No local Ollama rewrite model found')
}

export function buildKnowledgeExtractionPrompt(
  chapterTitle: string,
  chapterNo: number,
  rawText: string,
  mode: KnowledgeExtractionPromptMode = 'full'
) {
  const sourceLines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const truncated = sourceLines.length > EXTRACTION_MAX_PROMPT_LINES
  const excerptLines = truncated ? sourceLines.slice(0, EXTRACTION_MAX_PROMPT_LINES) : sourceLines
  const numberedLines = excerptLines
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')

  if (mode === 'focused') {
    return [
      `任务：只基于第 ${chapterNo} 章内容，补充抽取人物关系、世界设定和未解决线索。`,
      '只返回 1 个 JSON 对象。不要返回顶层数组。不要解释。不要输出 markdown。',
      '固定字段只能是：chapter_no、summary、characters、relations、events、worldbuilding、open_threads。',
      '本轮重点只抽取 relations、worldbuilding、open_threads。summary 可以简短；characters 和 events 若无必要一律返回空数组。',
      '结果必须精确、精简、可验证。不要把泛泛背景写成设定，不要把弱暗示写成关系，不要编造。',
      'evidence 字段固定使用 quote、line_start、line_end。不要使用 text、content 或其他字段名。',
      truncated ? `本次仅提供前 ${EXTRACTION_MAX_PROMPT_LINES} 行节选。不要猜测未提供的后续内容。` : '本次提供完整章节内容。',
      '最小示例：',
      '{"chapter_no":1,"summary":"","characters":[],"relations":[{"source":"甲","target":"乙","type":"同伴","polarity":"positive","strength":3,"change":"合作开始","valid_from_chapter":1,"evidence":[{"quote":"甲与乙决定同行。","line_start":3,"line_end":3}]}],"events":[],"worldbuilding":[{"term":"黑塔","category":"organization","definition":"一座负责训练学徒的组织。","evidence":[{"quote":"黑塔每年招收学徒。","line_start":8,"line_end":8}]}],"open_threads":[{"name":"失踪的导师","description":"导师去向未明，后续仍需解释。","evidence":[{"quote":"导师至今没有回来。","line_start":12,"line_end":12}]}]}',
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
    'evidence 字段固定使用 quote、line_start、line_end。不要使用 text、content 或其他字段名。',
    truncated ? `本次仅提供前 ${EXTRACTION_MAX_PROMPT_LINES} 行节选。不要猜测未提供的后续内容。` : '本次提供完整章节内容。',
    '最小示例：',
    '{"chapter_no":1,"summary":"一句话总结","characters":[{"name":"林澄","aliases":[],"status":"活跃","description_delta":"主角","evidence":[{"quote":"林澄开口说话。","line_start":1,"line_end":1}]}],"relations":[],"events":[],"worldbuilding":[],"open_threads":[]}',
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
  if (mode === 'focused') {
    return extraction.relations.length > 0
      || extraction.worldbuilding.length > 0
      || extraction.openThreads.length > 0
  }

  return extraction.characters.length > 0
    || extraction.relations.length > 0
    || extraction.events.length > 0
    || extraction.worldbuilding.length > 0
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
  mode?: KnowledgeExtractionPromptMode
}): Promise<OllamaExtractionResult> {
  const config = await getOllamaExtractionConfig()
  if (!config.enabled || !config.model) {
    return {
      enabled: false,
      error: config.reason ?? 'Ollama extraction disabled',
    }
  }

  const mode = params.mode ?? 'full'
  const prompt = buildKnowledgeExtractionPrompt(params.chapterTitle, params.chapterNo, params.rawText, mode)
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

function chunkTextStream(text: string) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const chunks = text.split(/(。|！|？|\n)/).filter(Boolean)
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
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

export async function generateRewriteWithOllama(input: OllamaRewriteRequest): Promise<OllamaRewriteResult> {
  const config = await getOllamaRewriteConfig()
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

export async function streamRewriteWithOllama(input: OllamaStreamRewriteRequest): Promise<OllamaStreamRewriteResult> {
  const config = await getOllamaRewriteConfig()
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
