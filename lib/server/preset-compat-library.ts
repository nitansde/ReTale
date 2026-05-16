import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import {
  PRESET_COMPAT_SOURCE_API_ID,
  PRESET_COMPAT_SURFACE_IDS,
  type PresetCompatLibrary,
  type PresetCompatPresetRecord,
  type PresetCompatPromptRule,
  type PresetCompatRegexPlacement,
  type PresetCompatRegexRecord,
  type PresetCompatSurfaceBinding,
  type PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import { findAppSettings, upsertAppSettings } from '@/lib/server/persistence'

const PRESET_COMPAT_LIBRARY_V1_KEY = 'PRESET_COMPAT_LIBRARY_V1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseStoredLibraryBlob(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeNullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeInteger(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

function normalizeNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizePassthrough(value: unknown) {
  return isRecord(value) ? value : {}
}

function normalizePromptRule(value: unknown): PresetCompatPromptRule | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    id: normalizeString(value.id),
    name: normalizeString(value.name),
    role: normalizeString(value.role, 'system'),
    content: normalizeString(value.content),
    enabled: normalizeBoolean(value.enabled),
    marker: normalizeBoolean(value.marker),
    injectAsSystemPrompt: normalizeBoolean(value.injectAsSystemPrompt),
    injectionPosition: value.injectionPosition === 'before'
      || value.injectionPosition === 'after'
      || value.injectionPosition === 'in_chat'
      || value.injectionPosition === 'none'
      ? value.injectionPosition
      : 'none',
    injectionDepth: typeof value.injectionDepth === 'number' && Number.isFinite(value.injectionDepth)
      ? value.injectionDepth
      : null,
    injectionOrder: typeof value.injectionOrder === 'number' && Number.isFinite(value.injectionOrder)
      ? value.injectionOrder
      : null,
    injectionTrigger: typeof value.injectionTrigger === 'string' ? value.injectionTrigger : null,
    forbidOverrides: normalizeBoolean(value.forbidOverrides),
    condition: typeof value.condition === 'string' ? value.condition : null,
    passthrough: normalizePassthrough(value.passthrough),
  }
}

function isRegexPlacement(value: unknown): value is PresetCompatRegexPlacement {
  return value === 'user_input'
    || value === 'assistant_output'
    || value === 'slash_command'
    || value === 'world_info'
    || value === 'reasoning'
    || value === 'md_display'
}

function normalizeRegexRecord(value: unknown): PresetCompatRegexRecord | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    id: normalizeString(value.id),
    name: normalizeString(value.name),
    pattern: normalizeString(value.pattern),
    replacement: normalizeString(value.replacement),
    flags: normalizeString(value.flags),
    disabled: normalizeBoolean(value.disabled),
    placements: Array.isArray(value.placements)
      ? value.placements.filter(isRegexPlacement)
      : [],
    trimStrings: normalizeStringArray(value.trimStrings),
    promptOnly: normalizeBoolean(value.promptOnly),
    markdownOnly: normalizeBoolean(value.markdownOnly),
    minDepth: normalizeNullableNumber(value.minDepth),
    maxDepth: normalizeNullableNumber(value.maxDepth),
    substituteRegex: typeof value.substituteRegex === 'string' ? value.substituteRegex : null,
    runOnEdit: normalizeBoolean(value.runOnEdit),
    passthrough: normalizePassthrough(value.passthrough),
  }
}

function normalizeRuntimeSampler(value: unknown): PresetCompatPresetRecord['runtimeSampler'] {
  const record = isRecord(value) ? value : {}

  return {
    temperature: normalizeNullableNumber(record.temperature),
    topP: normalizeNullableNumber(record.topP),
    topK: normalizeNullableNumber(record.topK),
    minP: normalizeNullableNumber(record.minP),
    presencePenalty: normalizeNullableNumber(record.presencePenalty),
    frequencyPenalty: normalizeNullableNumber(record.frequencyPenalty),
    repetitionPenalty: normalizeNullableNumber(record.repetitionPenalty),
    maxTokens: normalizeNullableNumber(record.maxTokens),
  }
}

function normalizePromptOrderLists(value: unknown): PresetCompatPresetRecord['promptOrderLists'] {
  if (!isRecord(value)) {
    return {}
  }

  const entries = PRESET_COMPAT_SURFACE_IDS.flatMap((surfaceId) => {
    const orderList = value[surfaceId]
    if (!Array.isArray(orderList)) {
      return [] as Array<[PresetCompatSurfaceId, string[]]>
    }

    return [[surfaceId, orderList.filter((item): item is string => typeof item === 'string')]]
  })

  return Object.fromEntries(entries) as PresetCompatPresetRecord['promptOrderLists']
}

function normalizePresetRecord(value: unknown): PresetCompatPresetRecord | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    id: normalizeString(value.id),
    name: normalizeString(value.name),
    sourceApiId: value.sourceApiId === PRESET_COMPAT_SOURCE_API_ID ? value.sourceApiId : PRESET_COMPAT_SOURCE_API_ID,
    promptRules: Array.isArray(value.promptRules)
      ? value.promptRules.map(normalizePromptRule).filter((item): item is PresetCompatPromptRule => item !== null)
      : [],
    promptOrderLists: normalizePromptOrderLists(value.promptOrderLists),
    embeddedRegexes: Array.isArray(value.embeddedRegexes)
      ? value.embeddedRegexes.map(normalizeRegexRecord).filter((item): item is PresetCompatRegexRecord => item !== null)
      : [],
    attachedStandaloneRegexIds: normalizeStringArray(value.attachedStandaloneRegexIds),
    runtimeSampler: normalizeRuntimeSampler(value.runtimeSampler),
    passthrough: normalizePassthrough(value.passthrough),
    importWarnings: normalizeStringArray(value.importWarnings),
    createdAt: normalizeString(value.createdAt),
    updatedAt: normalizeString(value.updatedAt),
  }
}

function normalizePresets(value: unknown) {
  if (!isRecord(value)) {
    return {} as PresetCompatLibrary['presets']
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([presetId, preset]) => [presetId, normalizePresetRecord(preset)] as const)
      .filter((entry): entry is readonly [string, PresetCompatPresetRecord] => entry[1] !== null)
  ) as PresetCompatLibrary['presets']
}

function normalizeStandaloneRegexes(value: unknown) {
  if (!isRecord(value)) {
    return {} as PresetCompatLibrary['standaloneRegexes']
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([regexId, regex]) => [regexId, normalizeRegexRecord(regex)] as const)
      .filter((entry): entry is readonly [string, PresetCompatRegexRecord] => entry[1] !== null)
  ) as PresetCompatLibrary['standaloneRegexes']
}

function normalizeSurfaceBinding(value: unknown, fallback: PresetCompatSurfaceBinding): PresetCompatSurfaceBinding {
  if (!isRecord(value)) {
    return fallback
  }

  return {
    surfaceId: fallback.surfaceId,
    presetId: typeof value.presetId === 'string' ? value.presetId : null,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    failClosed: typeof value.failClosed === 'boolean' ? value.failClosed : fallback.failClosed,
  }
}

function normalizeSurfaceBindings(value: unknown): PresetCompatLibrary['surfaceBindings'] {
  const defaults = createDefaultPresetCompatLibrary().surfaceBindings
  const record = isRecord(value) ? value : {}

  return Object.fromEntries(
    Object.entries(defaults).map(([surfaceId, binding]) => [
      surfaceId,
      normalizeSurfaceBinding(record[surfaceId], binding),
    ])
  ) as PresetCompatLibrary['surfaceBindings']
}

function normalizePresetCompatLibrary(value: unknown): PresetCompatLibrary {
  const defaults = createDefaultPresetCompatLibrary()
  if (!isRecord(value)) {
    return defaults
  }

  return {
    schemaVersion: defaults.schemaVersion,
    revision: normalizeInteger(value.revision, defaults.revision),
    presets: normalizePresets(value.presets),
    standaloneRegexes: normalizeStandaloneRegexes(value.standaloneRegexes),
    surfaceBindings: normalizeSurfaceBindings(value.surfaceBindings),
    lastImportedAt: normalizeNullableString(value.lastImportedAt),
    lastExportedAt: normalizeNullableString(value.lastExportedAt),
  }
}

export function loadStoredPresetCompatLibrary(): PresetCompatLibrary {
  const entries = findAppSettings([PRESET_COMPAT_LIBRARY_V1_KEY])
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value])) as Partial<Record<typeof PRESET_COMPAT_LIBRARY_V1_KEY, string>>
  const parsed = parseStoredLibraryBlob(map.PRESET_COMPAT_LIBRARY_V1)
  return normalizePresetCompatLibrary(parsed)
}

export function bumpPresetCompatLibraryRevision(library: PresetCompatLibrary): PresetCompatLibrary {
  const normalized = normalizePresetCompatLibrary(library)
  return {
    ...normalized,
    revision: normalized.revision + 1,
  }
}

export async function saveStoredPresetCompatLibrary(library: PresetCompatLibrary) {
  const next = bumpPresetCompatLibraryRevision(library)
  await upsertAppSettings([[PRESET_COMPAT_LIBRARY_V1_KEY, JSON.stringify(next)]])
  return next
}
