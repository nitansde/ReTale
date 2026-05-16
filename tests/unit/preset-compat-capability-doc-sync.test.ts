import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
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
const DOC_TEXT = readFileSync(DOC_PATH, 'utf8')

describe('preset compat capability doc sync', () => {
  it('includes the required sections and provenance markers', () => {
    expect(DOC_TEXT).toContain('# Preset compatibility')
    expect(DOC_TEXT).toContain('## Scope')
    expect(DOC_TEXT).toContain('## Clean-room provenance and attribution')
    expect(DOC_TEXT).toContain('## Opted-in runtime surfaces')
    expect(DOC_TEXT).toContain('## Provider capability matrix')
    expect(DOC_TEXT).toContain('## Prompt-rule subset')
    expect(DOC_TEXT).toContain('## Regex subset')
    expect(DOC_TEXT).toContain('## Preserved-only fields and passthrough behavior')
    expect(DOC_TEXT).toContain('## Limitations')
    expect(DOC_TEXT).toContain('## Stream buffering behavior')
    expect(DOC_TEXT).toContain('AGPL-3.0')
    expect(DOC_TEXT).toContain('clean-room')
    expect(DOC_TEXT).toContain('preserved-only')
    expect(DOC_TEXT).toContain('future_jump_bridge')
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
      expect(DOC_TEXT).toContain(`\`${fieldName}\``)
    }
  })

  it('documents every provider mapping and preserved-only field', () => {
    for (const capability of Object.values(PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX)) {
      expect(DOC_TEXT).toContain(`### \`${capability.provider}\``)

      for (const [fieldName, requestField] of Object.entries(capability.appliedFields)) {
        expect(DOC_TEXT).toContain(`| \`${fieldName}\` | \`${requestField}\` |`)
      }

      for (const fieldName of capability.preservedOnlyFields) {
        expect(DOC_TEXT).toContain(`\`${fieldName}\``)
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
})
