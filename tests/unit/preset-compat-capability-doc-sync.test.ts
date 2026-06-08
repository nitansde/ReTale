import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PRESET_COMPAT_FIELD_FAMILY_IDS,
  PRESET_COMPAT_PROMPT_RULE_PRESERVED_ONLY_FIELDS,
  PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES,
  PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX,
  PRESET_COMPAT_IMAGE_REQUEST_FIELD_PREFIXES,
} from '@/lib/preset-compat/capability-matrix'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
} from '@/lib/preset-compat/types'

const DOC_PATH = new URL('../../docs/preset-compatibility.md', import.meta.url)
const MAPPING_DOC_PATH = new URL('../../docs/preset-compatibility-field-mapping.md', import.meta.url)
const DOC_TEXT = readFileSync(DOC_PATH, 'utf8')
const MAPPING_DOC_TEXT = readFileSync(MAPPING_DOC_PATH, 'utf8')
const ALL_DOC_TEXT = `${DOC_TEXT}\n${MAPPING_DOC_TEXT}`

describe('preset compat capability doc sync', () => {
  it('includes the required sections and provenance markers', () => {
    expect(DOC_TEXT).toContain('# Preset compatibility')
    expect(DOC_TEXT).toContain('## Scope')
    expect(DOC_TEXT).toContain('## Clean-room provenance and attribution')
    expect(DOC_TEXT).toContain('## Canonical runtime path')
    expect(DOC_TEXT).toContain('## Structured runtime and UI metadata contract')
    expect(DOC_TEXT).toContain('## Provider capability matrix')
    expect(DOC_TEXT).toContain('## Route behavior')
    expect(DOC_TEXT).toContain('## Prompt-rule subset')
    expect(DOC_TEXT).toContain('## Regex subset')
    expect(DOC_TEXT).toContain('## Preserved-only fields and passthrough behavior')
    expect(DOC_TEXT).toContain('## Detailed field mapping')
    expect(DOC_TEXT).toContain('## Limitations')
    expect(DOC_TEXT).toContain('## Stream buffering behavior')
    expect(DOC_TEXT).toContain('AGPL-3.0')
    expect(DOC_TEXT).toContain('clean-room')
    expect(DOC_TEXT).toContain('preserved-only')
    expect(DOC_TEXT).toContain('future_jump_bridge')
    expect(DOC_TEXT).toContain('prompt-assembly.ts')
    expect(DOC_TEXT).toContain('fieldStatuses')
    expect(DOC_TEXT).toContain('providerControlIntents')
    expect(DOC_TEXT).toContain('contextWindow')
    expect(DOC_TEXT).toContain('streamPolicy')
  })

  it('lists every surfaced runtime id and prompt-role contract', () => {
    for (const surfaceId of PRESET_COMPAT_CREATIVE_SURFACE_IDS) {
      expect(DOC_TEXT).toContain(`\`${surfaceId}\``)
    }

    for (const surfaceId of PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS) {
      expect(DOC_TEXT).toContain(`\`${surfaceId}\``)
    }

    for (const role of PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES) {
      expect(DOC_TEXT).toContain(`\`${role}\``)
    }

    for (const fieldName of PRESET_COMPAT_PROMPT_RULE_PRESERVED_ONLY_FIELDS) {
      expect(ALL_DOC_TEXT).toContain(`\`${fieldName}\``)
    }
  })

  it('documents the implemented reset scope and fail-closed route behavior honestly', () => {
    expect(DOC_TEXT).toContain('no account reset')
    expect(DOC_TEXT).toContain('no settings reset')
    expect(DOC_TEXT).toContain('no snapshot reset')
    expect(DOC_TEXT).toContain('no full-user reset')
    expect(DOC_TEXT).toContain('no full chat history persistence')
    expect(DOC_TEXT).toContain('presetCompatSessionState')
    expect(DOC_TEXT).toContain('/api/rewrite')
    expect(DOC_TEXT).toContain('explicit request override > imported preset value > provider default')
    expect(DOC_TEXT).toContain('future_jump')
    expect(DOC_TEXT).toContain('ROUTE_UNSUPPORTED')
  })

  it('documents every provider mapping and preserved-only field', () => {
    for (const capability of Object.values(PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX)) {
      expect(DOC_TEXT).toContain(`### \`${capability.provider}\``)

      for (const [fieldName, requestField] of Object.entries(capability.appliedFields)) {
        expect(DOC_TEXT).toContain(`| \`${fieldName}\` | \`${requestField}\` |`)
      }

      for (const fieldName of capability.preservedOnlyFields) {
        expect(ALL_DOC_TEXT).toContain(`\`${fieldName}\``)
      }
    }
  })

  it('documents the regex subset and preserved passthrough surfaces', () => {
    expect(DOC_TEXT).toContain('`user_input`')
    expect(DOC_TEXT).toContain('`assistant_output`')
    expect(DOC_TEXT).toContain('`promptOnly`')
    expect(DOC_TEXT).toContain('`markdownOnly`')
    expect(DOC_TEXT).toContain('`minDepth`')
    expect(DOC_TEXT).toContain('`maxDepth`')
    expect(DOC_TEXT).toContain('`runOnEdit`')
    expect(DOC_TEXT).toContain('`substituteRegex`')
    expect(DOC_TEXT).toContain('`slash_command`')
    expect(DOC_TEXT).toContain('`world_info`')
    expect(DOC_TEXT).toContain('`reasoning`')
    expect(DOC_TEXT).toContain('`md_display`')
    expect(DOC_TEXT).toContain('`extensions.SPreset`')

    for (const prefix of PRESET_COMPAT_IMAGE_REQUEST_FIELD_PREFIXES) {
      expect(DOC_TEXT).toContain(`\`${prefix}\``)
    }
  })

  it('documents every field family in the detailed mapping doc', () => {
    expect(MAPPING_DOC_TEXT).toContain('# Preset compatibility field mapping')
    expect(MAPPING_DOC_TEXT).toContain('actual ReTale implementation')
    expect(MAPPING_DOC_TEXT).toContain('prompt-assembly.ts')
    expect(MAPPING_DOC_TEXT).toContain('passthrough.root')
    expect(MAPPING_DOC_TEXT).toContain('passthrough.extensions')
    expect(MAPPING_DOC_TEXT).toContain('Legacy flat prompt aliases and exclusions')

    for (const fieldFamilyId of PRESET_COMPAT_FIELD_FAMILY_IDS) {
      expect(MAPPING_DOC_TEXT).toContain(`\`${fieldFamilyId}\``)
    }
  })
})
