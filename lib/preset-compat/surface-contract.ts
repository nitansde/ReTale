import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
  PRESET_COMPAT_LIBRARY_INITIAL_REVISION,
  PRESET_COMPAT_LIBRARY_SCHEMA_VERSION,
  type PresetCompatLibrary,
  type PresetCompatSurfaceBinding,
  type PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'

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
  expand: {
    surfaceId: 'expand',
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
  polish: {
    surfaceId: 'polish',
    enabledByDefault: true,
    failClosed: false,
    channel: 'creative',
  },
  continue: {
    surfaceId: 'continue',
    enabledByDefault: true,
    failClosed: false,
    channel: 'creative',
  },
  future_jump_rewrite: {
    surfaceId: 'future_jump_rewrite',
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
export const PRESET_COMPAT_FAIL_CLOSED_SURFACE_REGISTRY_IDS = [...PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS]

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

export function createDefaultPresetCompatLibrary(): PresetCompatLibrary {
  return {
    schemaVersion: PRESET_COMPAT_LIBRARY_SCHEMA_VERSION,
    revision: PRESET_COMPAT_LIBRARY_INITIAL_REVISION,
    presets: {},
    standaloneRegexes: {},
    surfaceBindings: createDefaultPresetCompatSurfaceBindings(),
    lastImportedAt: null,
    lastExportedAt: null,
  }
}
