import { describe, expect, it } from 'vitest'
import chineseDefaultPreset from '@/config/presets/retale-default-zh-CN.json'
import { createChineseDefaultPreset, RETALE_DEFAULT_PRESET_ID } from '@/lib/preset-compat/default-preset'
import { exportPresetCompatPreset } from '@/lib/preset-compat/export'
import { normalizePresetCompatPresetImport } from '@/lib/preset-compat/normalize'
import { assemblePresetCompatRuntimePrompts } from '@/lib/preset-compat/prompt-assembly'
import { resolvePresetCompatRuntime, type PresetCompatRuntimeProviderDefaults } from '@/lib/preset-compat/resolve-runtime'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { PRESET_COMPAT_CREATIVE_SURFACE_IDS, PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS } from '@/lib/preset-compat/types'

const providers: PresetCompatRuntimeProviderDefaults[] = [
  {
    provider: 'openai-compatible',
    openAICompatible: {
      config: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test-model' },
      request: { temperature: 0.7, top_p: 0.9, max_tokens: 8192 },
    },
  },
  {
    provider: 'ollama',
    ollama: {
      config: { model: 'test-model', baseUrl: 'http://localhost:11434' },
      request: { temperature: 0.7, num_predict: 8192 },
    },
  },
]

describe('Chinese default creative preset', () => {
  it('keeps SillyTavern context slots and custom-prompt flags in importable and exported JSON', () => {
    const exported = JSON.parse(JSON.stringify(exportPresetCompatPreset(createChineseDefaultPreset()))) as typeof chineseDefaultPreset
    for (const payload of [chineseDefaultPreset, exported]) {
      const rules = new Map(payload.prompts.map((rule) => [rule.identifier, rule]))
      const activeOrder = payload.prompt_order.find((entry) => entry.character_id === 100001)!.order
      for (const id of ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory']) {
        expect(rules.get(id)).toMatchObject({ marker: true, system_prompt: true })
        expect(activeOrder).toContainEqual({ identifier: id, enabled: true })
      }
      expect(rules.get('main')).toMatchObject({ system_prompt: true, marker: false, role: 'user' })
      const writingRules = payload.prompts.filter((rule) => !rule.marker)
      expect(writingRules).toHaveLength(6)
      for (const rule of writingRules.filter((rule) => rule.identifier !== 'main')) {
        // SillyTavern only inserts custom relative prompts when this is explicitly false.
        expect(rule.system_prompt).toBe(false)
        expect(rule.injection_position).toBe(0)
      }
      expect(activeOrder.every((entry) => rules.has(entry.identifier))).toBe(true)
    }
  })

  it.each(PRESET_COMPAT_CREATIVE_SURFACE_IDS)('preserves native system instructions and model settings on %s', (surfaceId) => {
    for (const providerDefaults of providers) {
      const library = createDefaultPresetCompatLibrary()
      const runtime = resolvePresetCompatRuntime({ library, surfaceId, providerDefaults })
      const withoutPreset = createDefaultPresetCompatLibrary()
      withoutPreset.surfaceBindings[surfaceId].presetId = null
      const baseline = resolvePresetCompatRuntime({ library: withoutPreset, surfaceId, providerDefaults })

      expect(runtime.snapshot.activePresetId).toBe(RETALE_DEFAULT_PRESET_ID)
      expect(runtime.warnings).toEqual([])
      expect(runtime.providerRuntime).toEqual(baseline.providerRuntime)
      expect(runtime.providerControlIntents).toEqual([])
      expect(runtime.promptRules.ordered).toHaveLength(6)

      const assembled = assemblePresetCompatRuntimePrompts({
        surfaceId,
        resolvedRuntime: runtime,
        systemPrompt: '本轮只返回指定的 JSON blocks，不得改变字段。',
        userPrompt: '本轮目标：500 字，接续既有场景。',
      })
      expect(assembled.systemPrompt).toContain(library.builtinSystemPrompts[surfaceId].content)
      expect(assembled.systemPrompt).toContain('本轮只返回指定的 JSON blocks，不得改变字段。')
      expect(assembled.userPrompt).toContain('本轮目标：500 字，接续既有场景。')
      for (const rule of library.presets[RETALE_DEFAULT_PRESET_ID].promptRules) {
        expect(assembled.userPrompt).toContain(rule.content)
      }
      expect(assembled.metadata.macroDiagnostics).toEqual([])
    }
  })

  it.each(PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS)('does not inject creative preferences into %s', (surfaceId) => {
    const runtime = resolvePresetCompatRuntime({ library: createDefaultPresetCompatLibrary(), surfaceId, providerDefaults: providers[0] })
    expect(runtime.activePreset).toBeNull()
    expect(runtime.promptRules.ordered).toEqual([])
  })

  it('round-trips editable rules through the existing export/import path', () => {
    const preset = createChineseDefaultPreset()
    preset.promptRules[0].content = '用户修改后的任务偏好。'
    const exported = JSON.parse(JSON.stringify(exportPresetCompatPreset(preset)))
    const imported = normalizePresetCompatPresetImport(exported).preset
    expect(imported.promptRules.map(({ id, content, enabled, role }) => ({ id, content, enabled, role })))
      .toEqual(preset.promptRules.map(({ id, content, enabled, role }) => ({ id, content, enabled, role })))
    expect(imported.promptOrderLists).toEqual(preset.promptOrderLists)
    expect(imported.embeddedRegexes).toEqual([])
    expect(createChineseDefaultPreset().promptRules[0].content).not.toBe(preset.promptRules[0].content)
  })
})
