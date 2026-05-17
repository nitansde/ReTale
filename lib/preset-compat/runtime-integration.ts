import { registerPresetCompatCoreMacroBuiltins } from '@/lib/preset-compat/macro-builtins-core'
import { createPresetCompatEnvMacroBuiltins } from '@/lib/preset-compat/macro-builtins-env'
import { createPresetCompatRandomTimeMacroBuiltins } from '@/lib/preset-compat/macro-builtins-random-time'
import { registerPresetCompatVariableMacroBuiltins } from '@/lib/preset-compat/macro-builtins-variables'
import {
  createPresetCompatMacroContext,
  type PresetCompatMacroContext,
  type PresetCompatMacroDiagnostic,
} from '@/lib/preset-compat/macro-context'
import { createPresetCompatMacroRegistry, type PresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'
import type { PresetCompatResolvedRuntime } from '@/lib/preset-compat/resolve-runtime'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'

export type PresetCompatRuntimeMacroProcessing = {
  context: PresetCompatMacroContext
  registry: PresetCompatMacroRegistry
}

export type PresetCompatRuntimeMetadata = {
  macroDiagnostics: PresetCompatMacroDiagnostic[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readNumericSeed(runtime: PresetCompatResolvedRuntime) {
  const rootSeed = runtime.activePreset?.passthrough?.root
  if (isRecord(rootSeed) && typeof rootSeed.seed === 'number' && Number.isFinite(rootSeed.seed)) {
    return rootSeed.seed
  }

  if (runtime.providerRuntime.provider === 'ollama') {
    const seed = runtime.providerRuntime.request.options.seed
    if (typeof seed === 'number' && Number.isFinite(seed)) {
      return seed
    }
  }

  const openAiSeed = runtime.activePreset?.runtimeSampler.seed
  return typeof openAiSeed === 'number' && Number.isFinite(openAiSeed) ? openAiSeed : 0
}

function buildRuntimeValues(runtime: PresetCompatResolvedRuntime) {
  const values: Record<string, unknown> = {}
  const namesBehavior = runtime.namesBehavior
  if (namesBehavior) {
    values.user = namesBehavior.userName
    values.userName = namesBehavior.userName
    values.bot = namesBehavior.assistantName
    values.assistant = namesBehavior.assistantName
    values.assistantName = namesBehavior.assistantName
    values.characterName = namesBehavior.assistantName
  }

  if (runtime.providerRuntime.provider === 'openai-compatible') {
    if (typeof runtime.providerRuntime.request.max_tokens === 'number') {
      values.maxTokens = runtime.providerRuntime.request.max_tokens
      values.maxResponse = runtime.providerRuntime.request.max_tokens
    }
  } else {
    if (typeof runtime.providerRuntime.request.options.num_predict === 'number') {
      values.maxTokens = runtime.providerRuntime.request.options.num_predict
      values.maxResponse = runtime.providerRuntime.request.options.num_predict
    }
    if (typeof runtime.providerRuntime.request.options.seed === 'number') {
      values.seed = runtime.providerRuntime.request.options.seed
    }
  }

  const openaiMaxContext = runtime.activePreset?.runtimeSampler.openaiMaxContext
  if (typeof openaiMaxContext === 'number') {
    values.openaiMaxContext = openaiMaxContext
    values.maxContext = openaiMaxContext
  }

  return values
}

export function createPresetCompatRuntimeMacroProcessing(params: {
  surfaceId: PresetCompatSurfaceId
  resolvedRuntime: PresetCompatResolvedRuntime
}) : PresetCompatRuntimeMacroProcessing {
  const context = createPresetCompatMacroContext({
    surfaceId: params.surfaceId,
    phase: 'apply-runtime',
    seed: readNumericSeed(params.resolvedRuntime),
    runtimeValues: buildRuntimeValues(params.resolvedRuntime),
  })
  const registry = createPresetCompatMacroRegistry([
    ...registerPresetCompatCoreMacroBuiltins(),
    ...registerPresetCompatVariableMacroBuiltins(),
    ...createPresetCompatEnvMacroBuiltins(),
    ...createPresetCompatRandomTimeMacroBuiltins(),
  ])

  return {
    context,
    registry,
  }
}

export function createPresetCompatRuntimeMetadata(processing: PresetCompatRuntimeMacroProcessing): PresetCompatRuntimeMetadata {
  return {
    macroDiagnostics: [...processing.context.diagnostics],
  }
}
