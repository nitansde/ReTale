import { describe, expect, it } from 'vitest'
import {
  PRESET_COMPAT_MACRO_ALIAS_MAP,
  PRESET_COMPAT_MACRO_CAPABILITY_MATRIX,
  PRESET_COMPAT_MACRO_DIAGNOSTIC_CODES,
} from '@/lib/preset-compat/macro-types'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
  PRESET_COMPAT_SURFACE_IDS,
} from '@/lib/preset-compat/types'

describe('sillytavern macro capability contract', () => {
  it('locks the stable macro diagnostic codes', () => {
    expect(PRESET_COMPAT_MACRO_DIAGNOSTIC_CODES).toEqual([
      'UNKNOWN_MACRO',
      'UNSUPPORTED_MACRO',
      'MISSING_CONTEXT_VALUE',
      'MALFORMED_MACRO',
      'INVALID_ARGUMENTS',
      'UNSUPPORTED_RUNTIME_SURFACE',
      'REGEX_MACRO_UNSUPPORTED_MODE',
      'MACRO_CONTEXT_WARNING',
    ])
  })

  it('records per-surface macro capability metadata and explicit storage semantics', () => {
    const setvar = PRESET_COMPAT_MACRO_CAPABILITY_MATRIX.setvar
    const trim = PRESET_COMPAT_MACRO_CAPABILITY_MATRIX.trim
    const user = PRESET_COMPAT_MACRO_CAPABILITY_MATRIX.user
    const input = PRESET_COMPAT_MACRO_CAPABILITY_MATRIX.input
    const comment = PRESET_COMPAT_MACRO_CAPABILITY_MATRIX.comment

    expect(setvar.nameMatching).toBe('case-insensitive')
    expect(setvar.storage.preserveRawTextInStoredPresetPayload).toBe(true)
    expect(setvar.storage.preserveRawTextInExportedPresetPayload).toBe(true)
    expect(setvar.surfaces.rewrite.capability).toBe('supported-runtime')
    expect(trim.surfaces.future_jump.capability).toBe('supported-runtime')
    expect(user.surfaces.roleplay.capability).toBe('context-partial')
    expect(comment.surfaces.future_jump.capability).toBe('preserve-storage-only')
    expect(input.surfaces.rewrite.capability).toBe('unsupported-runtime')

    for (const surfaceId of PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS) {
      expect(setvar.surfaces[surfaceId]).toMatchObject({
        capability: 'unsupported-runtime',
        status: 'degraded',
        reason: 'ANALYTICAL_SURFACE_FAIL_CLOSED',
      })
    }

    for (const surfaceId of PRESET_COMPAT_SURFACE_IDS) {
      expect(setvar.surfaces[surfaceId]).toBeDefined()
      expect(input.surfaces[surfaceId]).toBeDefined()
    }
  })

  it('documents canonical names plus aliases without claiming evaluator parity yet', () => {
    expect(PRESET_COMPAT_MACRO_ALIAS_MAP.setvar).toBe('setvar')
    expect(PRESET_COMPAT_MACRO_ALIAS_MAP.SetVar).toBe('setvar')
    expect(PRESET_COMPAT_MACRO_ALIAS_MAP.user).toBe('user')
    expect(PRESET_COMPAT_MACRO_ALIAS_MAP.bot).toBe('bot')
    expect(PRESET_COMPAT_MACRO_ALIAS_MAP.charIfNotGroup).toBe('char')

    for (const surfaceId of PRESET_COMPAT_CREATIVE_SURFACE_IDS) {
      expect(PRESET_COMPAT_MACRO_CAPABILITY_MATRIX.setvar.surfaces[surfaceId].capability).toBe('supported-runtime')
    }
  })
})
