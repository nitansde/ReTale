import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_EDITABLE_SURFACE_IDS,
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
  PRESET_COMPAT_LIBRARY_INITIAL_REVISION,
  PRESET_COMPAT_LIBRARY_SCHEMA_VERSION,
  type PresetCompatBuiltinSystemPrompt,
  type PresetCompatCreativeSurfaceId,
  type PresetCompatEditableSurfaceId,
  type PresetCompatLibrary,
  type PresetCompatSurfaceBinding,
  type PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'

export const PRESET_COMPAT_EDITABLE_SURFACE_META: Record<
  PresetCompatEditableSurfaceId,
  {
    label: string
    bindingSummary: string
    builtinPromptSummary: string
  }
> = {
  rewrite: {
    label: 'Rewrite',
    bindingSummary: '用于 rewrite 的 save / continue / regenerate；所有 continue 生成都复用这里的预设。',
    builtinPromptSummary: '影响 rewrite 保存、rewrite regenerate，以及所有 continue 生成。',
  },
  future_jump: {
    label: 'Future Jump',
    bindingSummary: '仅用于 Future Jump 的目标节点生成与 regenerate，不参与 continue。',
    builtinPromptSummary: '只影响 Future Jump 目标节点改写，不参与 continue。',
  },
  roleplay: {
    label: 'Roleplay',
    bindingSummary: '仅用于角色扮演生成，不扩展到 rewrite / future jump 流。',
    builtinPromptSummary: '只影响角色扮演会话。',
  },
}

export const PRESET_COMPAT_SURFACE_REGISTRY: Record<
  PresetCompatSurfaceId,
  {
    surfaceId: PresetCompatSurfaceId
    enabledByDefault: boolean
    failClosed: boolean
    channel: 'creative' | 'analytical'
  }
> = {
  rewrite: {
    surfaceId: 'rewrite',
    enabledByDefault: true,
    failClosed: false,
    channel: 'creative',
  },
  roleplay: {
    surfaceId: 'roleplay',
    enabledByDefault: true,
    failClosed: false,
    channel: 'creative',
  },
  future_jump: {
    surfaceId: 'future_jump',
    enabledByDefault: true,
    failClosed: false,
    channel: 'creative',
  },
  future_jump_bridge: {
    surfaceId: 'future_jump_bridge',
    enabledByDefault: false,
    failClosed: true,
    channel: 'analytical',
  },
  what_if_delta_extraction: {
    surfaceId: 'what_if_delta_extraction',
    enabledByDefault: false,
    failClosed: true,
    channel: 'analytical',
  },
  knowledge_extraction: {
    surfaceId: 'knowledge_extraction',
    enabledByDefault: false,
    failClosed: true,
    channel: 'analytical',
  },
  embeddings: {
    surfaceId: 'embeddings',
    enabledByDefault: false,
    failClosed: true,
    channel: 'analytical',
  },
}

export const PRESET_COMPAT_OPTED_IN_SURFACE_IDS = [...PRESET_COMPAT_CREATIVE_SURFACE_IDS]
export const PRESET_COMPAT_EDITABLE_SURFACE_REGISTRY_IDS = [...PRESET_COMPAT_EDITABLE_SURFACE_IDS]
export const PRESET_COMPAT_FAIL_CLOSED_SURFACE_REGISTRY_IDS = [...PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS]

export const RETALE_CREATIVE_SYSTEM_PROMPT = [
  '你是 ReTale 的小说扩写/魔改写作模型。',
  '你必须严格遵守给定的小说世界状态、人物关系、事件线和设定。',
  '你只能使用上下文中提供的截至当前章节的信息。',
  '不要引入未来章节事实。',
  '不要擅自改变已确认的人物状态、阵营、关系和世界规则。',
  '如果用户要求魔改，可以改变当前片段及其后续走向，但不得和当前章节之前的事实矛盾。',
  '保持原文文风、叙事视角、人称、节奏和人物口吻。',
  '优先输出可直接替换或插入到小说中的正文，不要解释。',
].join('\n')

export const RETALE_FUTURE_JUMP_REWRITE_SYSTEM_PROMPT = [
  '你是 ReTale 的 Future Jump 目标节点改写生成器。',
  '你必须严格依据已给出的 what-if 分歧、桥接摘要、故事状态和目标未来节点上下文。',
  '你只返回一个 JSON 对象，不要解释，不要 markdown，不要额外字段。',
  'generatedTargetText 必须只包含可直接放入小说的正文。',
  '允许结果偏离原线后果，但必须保持世界设定、人物性格、关系变化与 what-if 分歧一致。',
].join('\n')

export function createDefaultPresetCompatSurfaceBindings(): Record<PresetCompatSurfaceId, PresetCompatSurfaceBinding> {
  return Object.fromEntries(
    Object.values(PRESET_COMPAT_SURFACE_REGISTRY).map((surface) => [
      surface.surfaceId,
      {
        surfaceId: surface.surfaceId,
        presetId: null,
        enabled: surface.enabledByDefault,
        failClosed: surface.failClosed,
      },
    ])
  ) as Record<PresetCompatSurfaceId, PresetCompatSurfaceBinding>
}

function getDefaultBuiltinSystemPromptContent(surfaceId: PresetCompatCreativeSurfaceId) {
  return surfaceId === 'future_jump'
    ? RETALE_FUTURE_JUMP_REWRITE_SYSTEM_PROMPT
    : RETALE_CREATIVE_SYSTEM_PROMPT
}

export function createDefaultPresetCompatBuiltinSystemPrompts(): Record<PresetCompatCreativeSurfaceId, PresetCompatBuiltinSystemPrompt> {
  return Object.fromEntries(
    PRESET_COMPAT_CREATIVE_SURFACE_IDS.map((surfaceId) => [
      surfaceId,
      {
        surfaceId,
        enabled: true,
        content: getDefaultBuiltinSystemPromptContent(surfaceId),
      },
    ])
  ) as Record<PresetCompatCreativeSurfaceId, PresetCompatBuiltinSystemPrompt>
}

export function createDefaultPresetCompatLibrary(): PresetCompatLibrary {
  return {
    schemaVersion: PRESET_COMPAT_LIBRARY_SCHEMA_VERSION,
    revision: PRESET_COMPAT_LIBRARY_INITIAL_REVISION,
    presets: {},
    standaloneRegexes: {},
    surfaceBindings: createDefaultPresetCompatSurfaceBindings(),
    builtinSystemPrompts: createDefaultPresetCompatBuiltinSystemPrompts(),
    lastImportedAt: null,
    lastExportedAt: null,
  }
}
