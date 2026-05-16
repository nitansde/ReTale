import { describe, expect, it } from 'vitest'
import {
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_REGISTRY_IDS,
  PRESET_COMPAT_OPTED_IN_SURFACE_IDS,
  PRESET_COMPAT_SURFACE_REGISTRY,
  createDefaultPresetCompatLibrary,
  createDefaultPresetCompatSurfaceBindings,
} from '@/lib/preset-compat/surface-contract'

describe('preset compat surface contract', () => {
  it('keeps the opted-in creative surfaces explicit', () => {
    expect(PRESET_COMPAT_OPTED_IN_SURFACE_IDS).toEqual([
      'rewrite',
      'expand',
      'roleplay',
      'polish',
      'continue',
      'future_jump_rewrite',
    ])
  })

  it('keeps analytical surfaces fail-closed unless explicitly enabled later', () => {
    expect(PRESET_COMPAT_FAIL_CLOSED_SURFACE_REGISTRY_IDS).toEqual([
      'future_jump_bridge',
      'what_if_delta_extraction',
      'knowledge_extraction',
      'embeddings',
    ])

    expect(PRESET_COMPAT_SURFACE_REGISTRY.future_jump_bridge).toMatchObject({
      enabledByDefault: false,
      failClosed: true,
      channel: 'analytical',
    })
    expect(PRESET_COMPAT_SURFACE_REGISTRY.what_if_delta_extraction).toMatchObject({
      enabledByDefault: false,
      failClosed: true,
      channel: 'analytical',
    })
    expect(PRESET_COMPAT_SURFACE_REGISTRY.knowledge_extraction).toMatchObject({
      enabledByDefault: false,
      failClosed: true,
      channel: 'analytical',
    })
    expect(PRESET_COMPAT_SURFACE_REGISTRY.embeddings).toMatchObject({
      enabledByDefault: false,
      failClosed: true,
      channel: 'analytical',
    })
  })

  it('provides default library and binding records from the registry', () => {
    const bindings = createDefaultPresetCompatSurfaceBindings()
    const library = createDefaultPresetCompatLibrary()

    expect(bindings.rewrite).toEqual({
      surfaceId: 'rewrite',
      presetId: null,
      enabled: true,
      failClosed: false,
    })
    expect(bindings.embeddings).toEqual({
      surfaceId: 'embeddings',
      presetId: null,
      enabled: false,
      failClosed: true,
    })

    expect(library).toMatchObject({
      schemaVersion: 1,
      revision: 0,
      presets: {},
      standaloneRegexes: {},
      lastImportedAt: null,
      lastExportedAt: null,
    })
    expect(Object.keys(library.surfaceBindings)).toEqual(Object.keys(PRESET_COMPAT_SURFACE_REGISTRY))
  })
})
