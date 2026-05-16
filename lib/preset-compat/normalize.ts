import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_SOURCE_API_ID,
  type PresetCompatPresetRecord,
  type PresetCompatPromptRule,
  type PresetCompatRegexPlacement,
  type PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'

const ACTIVE_PROMPT_ORDER_CHARACTER_ID = 100000
const PROMPT_EXPORT_META_KEY = '__presetCompatPromptMeta'
const REGEX_EXPORT_META_KEY = '__presetCompatRegexMeta'

const REGEX_PLACEMENT_FROM_ST: Record<number, PresetCompatRegexPlacement> = {
  0: 'md_display',
  1: 'user_input',
  2: 'assistant_output',
  3: 'slash_command',
  6: 'world_info',
  7: 'reasoning',
}

const REGEX_PLACEMENT_TO_ST: Record<PresetCompatRegexPlacement, number> = {
  md_display: 0,
  user_input: 1,
  assistant_output: 2,
  slash_command: 3,
  world_info: 6,
  reasoning: 7,
}

type NameConflictPolicy = 'copy'

type PromptExportMeta = {
  injectionPosition?: unknown
  injectionTrigger?: unknown
}

type RegexExportMeta = {
  placement?: unknown
  substituteRegex?: unknown
}

export type NormalizePresetCompatPresetOptions = {
  uploadedFileName?: string | null
  nameHint?: string | null
  existingNames?: Iterable<string>
  now?: string
  idFactory?: () => string
  conflictPolicy?: NameConflictPolicy
}

export type NormalizePresetCompatStandaloneRegexOptions = {
  existingNames?: Iterable<string>
  idFactory?: () => string
  conflictPolicy?: NameConflictPolicy
}

export type NormalizedPresetCompatPresetImport = {
  preset: PresetCompatPresetRecord
  warnings: string[]
}

export type NormalizedPresetCompatStandaloneRegexImport = {
  regexes: PresetCompatRegexRecord[]
  warnings: string[]
}

type RawPromptOrderEntry = {
  character_id?: unknown
  order?: unknown
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function toRecordClone(value: unknown) {
  return isRecord(value) ? cloneValue(value) : {}
}

function normalizeDisplayName(baseName: string, existingNames: Iterable<string>, conflictPolicy: NameConflictPolicy = 'copy') {
  const trimmed = baseName.trim() || 'Imported preset'
  if (conflictPolicy !== 'copy') {
    return trimmed
  }

  const existing = new Set(Array.from(existingNames, (name) => name.trim()).filter(Boolean))
  if (!existing.has(trimmed)) {
    return trimmed
  }

  let copyIndex = 1
  while (true) {
    const nextName = copyIndex === 1 ? `${trimmed} (copy)` : `${trimmed} (copy ${copyIndex})`
    if (!existing.has(nextName)) {
      return nextName
    }
    copyIndex += 1
  }
}

function fileNameToDisplayName(fileName: string | null | undefined) {
  if (!fileName) {
    return ''
  }

  const basename = fileName.split(/[\\/]/).pop() ?? fileName
  return basename.replace(/\.[^.]+$/, '').trim()
}

function pickPresetName(rawPreset: Record<string, unknown>, options: NormalizePresetCompatPresetOptions) {
  const uploadedFileName = fileNameToDisplayName(options.uploadedFileName)
  const hintedName = typeof options.nameHint === 'string' ? options.nameHint.trim() : ''
  const rawName = typeof rawPreset.name === 'string' ? rawPreset.name.trim() : ''
  const baseName = uploadedFileName || hintedName || rawName || 'Imported preset'
  return normalizeDisplayName(baseName, options.existingNames ?? [], options.conflictPolicy)
}

function makeId(idFactory?: () => string) {
  return idFactory ? idFactory() : crypto.randomUUID()
}

function normalizePromptOrderEntries(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord).map((entry) => entry as RawPromptOrderEntry) : []
}

function getActivePromptOrderEntry(entries: RawPromptOrderEntry[]) {
  return entries.find((entry) => entry.character_id === ACTIVE_PROMPT_ORDER_CHARACTER_ID)
    ?? entries.find((entry) => Array.isArray(entry.order))
    ?? null
}

function getActivePromptOrderState(activeEntry: RawPromptOrderEntry | null) {
  const activeOrder = Array.isArray(activeEntry?.order) ? activeEntry.order.filter(isRecord) : []
  const enabledById = new Map<string, boolean>()
  const orderedIds: string[] = []

  for (const entry of activeOrder) {
    const identifier = typeof entry.identifier === 'string' ? entry.identifier : ''
    if (!identifier) {
      continue
    }

    orderedIds.push(identifier)
    enabledById.set(identifier, asBoolean(entry.enabled, false))
  }

  return { activeOrder, enabledById, orderedIds }
}

function normalizePromptInjectionPosition(
  rawPrompt: Record<string, unknown>,
  orderedIds: string[],
  identifier: string
): PresetCompatPromptRule['injectionPosition'] {
  if (rawPrompt.injection_position === 1) {
    return 'in_chat'
  }

  const promptIndex = orderedIds.indexOf(identifier)
  const chatHistoryIndex = orderedIds.indexOf('chatHistory')
  if (promptIndex === -1) {
    return 'none'
  }
  if (chatHistoryIndex !== -1 && promptIndex > chatHistoryIndex) {
    return 'after'
  }
  return 'before'
}

function extractUnknownFields(source: Record<string, unknown>, knownKeys: string[]) {
  const known = new Set(knownKeys)
  return Object.fromEntries(Object.entries(source).filter(([key]) => !known.has(key)))
}

function normalizePromptRule(
  rawPrompt: unknown,
  orderedIds: string[],
  enabledById: Map<string, boolean>,
  idFactory?: () => string
) {
  if (!isRecord(rawPrompt)) {
    return null
  }

  const identifier = typeof rawPrompt.identifier === 'string' && rawPrompt.identifier.trim()
    ? rawPrompt.identifier
    : makeId(idFactory)
  const unknownFields = extractUnknownFields(rawPrompt, [
    'identifier',
    'name',
    'role',
    'content',
    'enabled',
    'marker',
    'system_prompt',
    'injection_position',
    'injection_depth',
    'injection_order',
    'injection_trigger',
    'forbid_overrides',
    'condition',
  ])

  const prompt: PresetCompatPromptRule = {
    id: identifier,
    name: asString(rawPrompt.name, identifier),
    role: asString(rawPrompt.role, 'system'),
    content: asString(rawPrompt.content),
    enabled: enabledById.has(identifier) ? enabledById.get(identifier) === true : asBoolean(rawPrompt.enabled, false),
    marker: asBoolean(rawPrompt.marker, false),
    injectAsSystemPrompt: asBoolean(rawPrompt.system_prompt, false),
    injectionPosition: normalizePromptInjectionPosition(rawPrompt, orderedIds, identifier),
    injectionDepth: asNullableNumber(rawPrompt.injection_depth),
    injectionOrder: asNullableNumber(rawPrompt.injection_order),
    injectionTrigger: typeof rawPrompt.injection_trigger === 'string' ? rawPrompt.injection_trigger : null,
    forbidOverrides: asBoolean(rawPrompt.forbid_overrides, false),
    condition: typeof rawPrompt.condition === 'string' ? rawPrompt.condition : null,
    passthrough: {
      ...unknownFields,
      [PROMPT_EXPORT_META_KEY]: {
        injectionPosition: rawPrompt.injection_position,
        injectionTrigger: cloneValue(rawPrompt.injection_trigger),
      } satisfies PromptExportMeta,
    },
  }

  return prompt
}

function normalizePlacementList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as PresetCompatRegexPlacement[]
  }

  const placements: PresetCompatRegexPlacement[] = []
  for (const rawPlacement of value) {
    const normalized = typeof rawPlacement === 'number' ? REGEX_PLACEMENT_FROM_ST[rawPlacement] : null
    if (normalized && !placements.includes(normalized)) {
      placements.push(normalized)
    }
  }
  return placements
}

function normalizeTrimStrings(value: unknown, warningPrefix: string, warnings: string[]) {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      warnings.push(`${warningPrefix} trimStrings was not an array and was replaced with an empty list.`)
    }
    return [] as string[]
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeRegexRecord(
  rawRegex: unknown,
  index: number,
  namesInUse: Set<string>,
  warnings: string[],
  options: NormalizePresetCompatStandaloneRegexOptions & { idFactory?: () => string }
) {
  if (!isRecord(rawRegex)) {
    warnings.push(`Regex entry ${index + 1} was not an object and was skipped.`)
    return null
  }

  const pattern = typeof rawRegex.findRegex === 'string' ? rawRegex.findRegex : null
  const replacement = typeof rawRegex.replaceString === 'string' ? rawRegex.replaceString : null
  if (pattern === null || replacement === null) {
    warnings.push(`Regex entry ${index + 1} was missing findRegex or replaceString and was skipped.`)
    return null
  }

  const rawName = typeof rawRegex.scriptName === 'string' && rawRegex.scriptName.trim()
    ? rawRegex.scriptName
    : `Imported regex ${index + 1}`
  const resolvedName = normalizeDisplayName(rawName, namesInUse, options.conflictPolicy)
  namesInUse.add(resolvedName)

  const unknownFields = extractUnknownFields(rawRegex, [
    'id',
    'scriptName',
    'findRegex',
    'replaceString',
    'trimStrings',
    'placement',
    'disabled',
    'markdownOnly',
    'promptOnly',
    'runOnEdit',
    'substituteRegex',
    'minDepth',
    'maxDepth',
  ])

  const regexRecord: PresetCompatRegexRecord = {
    id: typeof rawRegex.id === 'string' && rawRegex.id.trim() ? rawRegex.id : makeId(options.idFactory),
    name: resolvedName,
    pattern,
    replacement,
    flags: '',
    disabled: asBoolean(rawRegex.disabled, false),
    placements: normalizePlacementList(rawRegex.placement),
    trimStrings: normalizeTrimStrings(rawRegex.trimStrings, `Regex entry ${index + 1}`, warnings),
    promptOnly: asBoolean(rawRegex.promptOnly, false),
    markdownOnly: asBoolean(rawRegex.markdownOnly, false),
    minDepth: asNullableNumber(rawRegex.minDepth),
    maxDepth: asNullableNumber(rawRegex.maxDepth),
    substituteRegex: typeof rawRegex.substituteRegex === 'string' ? rawRegex.substituteRegex : null,
    runOnEdit: asBoolean(rawRegex.runOnEdit, false),
    passthrough: {
      ...unknownFields,
      [REGEX_EXPORT_META_KEY]: {
        placement: cloneValue(rawRegex.placement),
        substituteRegex: cloneValue(rawRegex.substituteRegex),
      } satisfies RegexExportMeta,
    },
  }

  return regexRecord
}

function getRegexArrayFromStandalonePayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!isRecord(payload)) {
    return []
  }
  if (Array.isArray(payload.regex_scripts)) {
    return payload.regex_scripts
  }
  if (isRecord(payload.RegexBinding) && Array.isArray(payload.RegexBinding.regexes)) {
    return payload.RegexBinding.regexes
  }
  if (isRecord(payload.SPreset) && isRecord(payload.SPreset.RegexBinding) && Array.isArray(payload.SPreset.RegexBinding.regexes)) {
    return payload.SPreset.RegexBinding.regexes
  }
  return []
}

export function getPromptExportMeta(promptRule: PresetCompatPromptRule) {
  const meta = isRecord(promptRule.passthrough[PROMPT_EXPORT_META_KEY])
    ? promptRule.passthrough[PROMPT_EXPORT_META_KEY]
    : {}
  return meta as PromptExportMeta
}

export function getRegexExportMeta(regexRecord: PresetCompatRegexRecord) {
  const meta = isRecord(regexRecord.passthrough[REGEX_EXPORT_META_KEY])
    ? regexRecord.passthrough[REGEX_EXPORT_META_KEY]
    : {}
  return meta as RegexExportMeta
}

export function stripInternalPromptPassthroughMeta(passthrough: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(passthrough).filter(([key]) => key !== PROMPT_EXPORT_META_KEY))
}

export function stripInternalRegexPassthroughMeta(passthrough: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(passthrough).filter(([key]) => key !== REGEX_EXPORT_META_KEY))
}

export function resolvePresetCompatCopyName(baseName: string, existingNames: Iterable<string>) {
  return normalizeDisplayName(baseName, existingNames)
}

export function normalizePresetCompatStandaloneRegexImport(
  payload: unknown,
  options: NormalizePresetCompatStandaloneRegexOptions = {}
): NormalizedPresetCompatStandaloneRegexImport {
  const warnings: string[] = []
  const regexPayload = getRegexArrayFromStandalonePayload(payload)
  const namesInUse = new Set(Array.from(options.existingNames ?? []).filter((name): name is string => typeof name === 'string'))

  if (!Array.isArray(regexPayload)) {
    return { regexes: [], warnings: ['Standalone regex payload was not an array and was skipped.'] }
  }

  const regexes = regexPayload
    .map((entry, index) => normalizeRegexRecord(entry, index, namesInUse, warnings, options))
    .filter((entry): entry is PresetCompatRegexRecord => entry !== null)

  return { regexes, warnings }
}

export function normalizePresetCompatPresetImport(
  payload: unknown,
  options: NormalizePresetCompatPresetOptions = {}
): NormalizedPresetCompatPresetImport {
  const rawPreset = isRecord(payload) ? payload : {}
  const warnings: string[] = []
  const now = options.now ?? new Date().toISOString()
  const presetId = makeId(options.idFactory)
  const promptOrderEntries = normalizePromptOrderEntries(rawPreset.prompt_order)
  const activeEntry = getActivePromptOrderEntry(promptOrderEntries)
  const { enabledById, orderedIds } = getActivePromptOrderState(activeEntry)

  const promptRules = Array.isArray(rawPreset.prompts)
    ? rawPreset.prompts
      .map((prompt) => normalizePromptRule(prompt, orderedIds, enabledById, options.idFactory))
      .filter((prompt): prompt is PresetCompatPromptRule => prompt !== null)
    : []

  const embeddedRegexResult = normalizePresetCompatStandaloneRegexImport(
    isRecord(rawPreset.extensions) ? rawPreset.extensions.regex_scripts : [],
    {
      conflictPolicy: options.conflictPolicy,
      existingNames: [],
      idFactory: options.idFactory,
    }
  )
  warnings.push(...embeddedRegexResult.warnings.map((warning) => `Preset embedded regex: ${warning}`))

  const promptOrderIds = orderedIds.slice()
  const promptOrderLists = Object.fromEntries(
    PRESET_COMPAT_CREATIVE_SURFACE_IDS.map((surfaceId) => [surfaceId, promptOrderIds])
  ) as PresetCompatPresetRecord['promptOrderLists']

  const passthroughRoot = Object.fromEntries(
    Object.entries(rawPreset)
      .filter(([key]) => key !== 'extensions')
      .map(([key, value]) => [key, cloneValue(value)])
  )
  const passthroughExtensions = isRecord(rawPreset.extensions) ? cloneValue(rawPreset.extensions) : {}
  const unknownPromptFields = Object.fromEntries(
    promptRules
      .map((promptRule) => [promptRule.id, stripInternalPromptPassthroughMeta(promptRule.passthrough)] as const)
      .filter(([, value]) => Object.keys(value).length > 0)
  )

  const preset: PresetCompatPresetRecord = {
    id: presetId,
    name: pickPresetName(rawPreset, options),
    sourceApiId: PRESET_COMPAT_SOURCE_API_ID,
    promptRules,
    promptOrderLists,
    embeddedRegexes: embeddedRegexResult.regexes,
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: asNullableNumber(rawPreset.temperature),
      topP: asNullableNumber(rawPreset.top_p),
      topK: asNullableNumber(rawPreset.top_k),
      minP: asNullableNumber(rawPreset.min_p),
      presencePenalty: asNullableNumber(rawPreset.presence_penalty),
      frequencyPenalty: asNullableNumber(rawPreset.frequency_penalty),
      repetitionPenalty: asNullableNumber(rawPreset.repetition_penalty),
      maxTokens: asNullableNumber(rawPreset.openai_max_tokens),
    },
    passthrough: {
      root: passthroughRoot,
      extensions: passthroughExtensions,
      unknownPromptFields,
    },
    importWarnings: warnings,
    createdAt: now,
    updatedAt: now,
  }

  return { preset, warnings }
}
