export const WRITING_SKILL_CONTEXT_WINDOWS = ['auto', '32k', '64k', '96k', '128k', '256k', '512k', '1m'] as const
export type WritingSkillContextWindow = (typeof WRITING_SKILL_CONTEXT_WINDOWS)[number]

export const WRITING_SKILL_TOTAL_BUDGETS = ['128k', '256k', '512k', '1m', '2m', 'full'] as const
export type WritingSkillTotalBudget = (typeof WRITING_SKILL_TOTAL_BUDGETS)[number]

export const DEFAULT_WRITING_SKILL_CONTEXT_WINDOW: WritingSkillContextWindow = 'auto'
export const DEFAULT_WRITING_SKILL_TOTAL_BUDGET: WritingSkillTotalBudget = '512k'

const WRITING_SKILL_CONTEXT_WINDOW_TOKENS: Record<Exclude<WritingSkillContextWindow, 'auto'>, number> = {
  '32k': 32_000,
  '64k': 64_000,
  '96k': 96_000,
  '128k': 128_000,
  '256k': 256_000,
  '512k': 512_000,
  '1m': 1_000_000,
}

const WRITING_SKILL_TOTAL_BUDGET_TOKENS: Record<Exclude<WritingSkillTotalBudget, 'full'>, number> = {
  '128k': 128_000,
  '256k': 256_000,
  '512k': 512_000,
  '1m': 1_000_000,
  '2m': 2_000_000,
}

export const WRITING_SKILL_DEFAULTS = {
  scanInputRatio: 0.84,
  contextReserveRatio: 0.12,
  minCandidates: 8,
  targetCandidates: 24,
  maxCandidatesPerRound: 48,
  maxScanRounds: 64,
  maxAdaptiveScanRetries: 3,
  minAdaptiveScanBudget: 8_000,
  zeroCandidateRetryThreshold: 8_000,
  maxDistillRanges: 30,
  minExamplePoolSize: 6,
  targetExamplePoolSize: 12,
  maxExamplePoolSize: 20,
  defaultRuntimeExampleCount: 3,
  maxRuntimeExampleCount: 5,
  scanTemperature: 0.1,
  distillTemperature: 0.3,
  expectedScanOutputTokens: 4096,
  expectedDistillOutputTokens: 4096,
  fixedPromptOverheadTokens: 1200,
  sourceLeakNgramLength: 18,
} as const

export function normalizeWritingSkillContextWindow(value: unknown): WritingSkillContextWindow {
  return typeof value === 'string' && WRITING_SKILL_CONTEXT_WINDOWS.includes(value as WritingSkillContextWindow)
    ? value as WritingSkillContextWindow
    : DEFAULT_WRITING_SKILL_CONTEXT_WINDOW
}

export function normalizeWritingSkillTotalBudget(value: unknown): WritingSkillTotalBudget {
  return typeof value === 'string' && WRITING_SKILL_TOTAL_BUDGETS.includes(value as WritingSkillTotalBudget)
    ? value as WritingSkillTotalBudget
    : DEFAULT_WRITING_SKILL_TOTAL_BUDGET
}

export type ModelCapabilities = {
  contextWindow: number
  maxOutputTokens: number
  supportsStructuredOutput: boolean
  supportsToolCalling: boolean
}

export function calculateWritingSkillScanChunkBudget(
  capabilities: ModelCapabilities,
  contextWindow: WritingSkillContextWindow = DEFAULT_WRITING_SKILL_CONTEXT_WINDOW,
) {
  const requestedContextWindow = contextWindow === 'auto'
    ? capabilities.contextWindow
    : WRITING_SKILL_CONTEXT_WINDOW_TOKENS[contextWindow]
  const selectedContextWindow = Math.min(requestedContextWindow, capabilities.contextWindow)
  const safetyReserve = Math.floor(
    selectedContextWindow * WRITING_SKILL_DEFAULTS.contextReserveRatio,
  )
  const expectedOutputTokens = Math.min(
    WRITING_SKILL_DEFAULTS.expectedScanOutputTokens,
    capabilities.maxOutputTokens,
  )
  const usableContext = Math.max(
    0,
    selectedContextWindow
      - expectedOutputTokens
      - WRITING_SKILL_DEFAULTS.fixedPromptOverheadTokens
      - safetyReserve,
  )

  const safeModelBudget = Math.max(0, Math.min(
    usableContext,
    Math.floor(selectedContextWindow * WRITING_SKILL_DEFAULTS.scanInputRatio),
  ))
  return safeModelBudget
}

export function resolveWritingSkillTotalBudget(totalBudget: WritingSkillTotalBudget) {
  return totalBudget === 'full' ? null : WRITING_SKILL_TOTAL_BUDGET_TOKENS[totalBudget]
}
