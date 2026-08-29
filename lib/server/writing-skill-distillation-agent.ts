import { randomBytes } from 'node:crypto'
import {
  WRITING_SKILL_DEFAULTS,
  calculateWritingSkillScanChunkBudget,
  normalizeWritingSkillContextWindow,
  normalizeWritingSkillTotalBudget,
  resolveWritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'
import type { MaterialScanResult, SkillDistillationResult } from '@/lib/writing-skill-types'
import {
  compileEvidenceMaterial,
  compileNumberedMaterial,
  deriveWritingSkillRoundSeed,
  getRangeParagraphs,
  loadMaterialLibrary,
  mergeWritingSkillCandidateRanges,
  rangeContainsDisplayRef,
  resolveMaterialRange,
  sampleWritingSkillMaterial,
  selectWritingSkillEvidenceRanges,
  toSampledRangeRecord,
  validateWritingSkillScanResult,
  type MaterialLibrary,
  type ValidatedCandidateRange,
} from '@/lib/server/writing-skill-material'
import {
  loadWritingSkillMaterialCollection,
  normalizeWritingSkillSourceRefs,
} from '@/lib/server/writing-skill-sources'
import {
  ConfiguredWritingSkillModelGateway,
  isWritingSkillContextLimitError,
  type ModelGateway,
  type StructuredGenerationResult,
} from '@/lib/server/writing-skill-model-gateway'
import {
  buildMaterialScanPrompt,
  buildMaterialScanJsonSchema,
  buildMaterialScanRuntimeSchema,
  buildSkillDistillationJsonSchema,
  buildSkillDistillationPrompt,
  buildSkillDistillationRuntimeSchema,
} from '@/lib/server/writing-skill-prompts'
import {
  markWritingSkillCardsStaleForLibraryVersion,
  readWritingSkillCardDetail,
  readWritingSkillJob,
  readWritingSkillJobRequest,
  saveWritingSkillCard,
  updateWritingSkillJob,
  type WritingSkillStoreDb,
} from '@/lib/server/writing-skill-store'

class InsufficientWritingSkillEvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsufficientWritingSkillEvidenceError'
  }
}

class CancelledWritingSkillJobError extends Error {
  constructor() {
    super('Writing skill job cancelled')
    this.name = 'CancelledWritingSkillJobError'
  }
}

export function createWritingSkillRandomSeed() {
  return randomBytes(4).readUInt32BE(0) & 0x7fffffff
}

function findContainingCandidate(
  ref: string,
  candidates: ValidatedCandidateRange[],
  library: MaterialLibrary,
) {
  return candidates.find((candidate) => rangeContainsDisplayRef(candidate, ref, library)) ?? null
}

function normalizeComparableText(value: string) {
  return value.replace(/[\s\p{P}\p{S}]/gu, '')
}

function hasSourceLeak(output: string, sourceTexts: string[], ngramLength: number) {
  const normalizedOutput = normalizeComparableText(output)
  if (normalizedOutput.length < ngramLength) return false
  for (const sourceText of sourceTexts) {
    const normalizedSource = normalizeComparableText(sourceText)
    for (let index = 0; index + ngramLength <= normalizedSource.length; index += 1) {
      if (normalizedOutput.includes(normalizedSource.slice(index, index + ngramLength))) return true
    }
  }
  return false
}

function validateDistillationResult(input: {
  result: SkillDistillationResult
  candidates: ValidatedCandidateRange[]
  library: MaterialLibrary
}) {
  const issues: string[] = []
  const evidenceTexts = input.candidates.flatMap((candidate) => (
    getRangeParagraphs(input.library, candidate.displayRef, 1).map((paragraph) => paragraph.anonymizedText)
  ))
  const evidenceOutput = [
    input.result.title,
    input.result.summary,
    input.result.applicationScope,
    ...input.result.rules.map((rule) => rule.text),
    ...input.result.avoid,
  ].join('\n')
  if (hasSourceLeak(evidenceOutput, evidenceTexts, WRITING_SKILL_DEFAULTS.sourceLeakNgramLength)) {
    issues.push('总结或规则与素材原文出现过长连续重合，必须改写为抽象方法')
  }

  for (const [index, rule] of input.result.rules.entries()) {
    if (!rule.evidenceRefs.length) issues.push(`第 ${index + 1} 条规则缺少证据引用`)
    for (const ref of rule.evidenceRefs) {
      if (!resolveMaterialRange(input.library, ref) || !findContainingCandidate(ref, input.candidates, input.library)) {
        issues.push(`规则引用 ${ref} 不属于候选证据`)
      }
    }
  }

  const uniqueExamples = new Set<string>()
  const chapterCounts = new Map<string, number>()
  for (const example of input.result.exampleCandidates) {
    const resolved = resolveMaterialRange(input.library, example.ref)
    if (!resolved || !findContainingCandidate(example.ref, input.candidates, input.library)) {
      issues.push(`范文引用 ${example.ref} 不属于候选证据`)
      continue
    }
    uniqueExamples.add(resolved.displayRef)
    chapterCounts.set(resolved.start.chapterId, (chapterCounts.get(resolved.start.chapterId) ?? 0) + 1)
  }
  if (uniqueExamples.size < WRITING_SKILL_DEFAULTS.minExamplePoolSize) {
    issues.push(`有效范文引用少于 ${WRITING_SKILL_DEFAULTS.minExamplePoolSize} 组`)
  }
  const maxChapterCount = Math.max(0, ...chapterCounts.values())
  if (
    input.result.exampleCandidates.length >= 8
    && maxChapterCount > Math.ceil(input.result.exampleCandidates.length * 0.5)
    && new Set(input.candidates.map((candidate) => candidate.chapterId)).size > 1
  ) {
    issues.push('范文引用过度集中在同一章节，需要增加章节多样性')
  }
  return Array.from(new Set(issues))
}

function normalizeValidatedDistillationResult(input: {
  result: SkillDistillationResult
  candidates: ValidatedCandidateRange[]
  library: MaterialLibrary
}) {
  const rules = input.result.rules.map((rule) => ({
    text: rule.text.trim(),
    evidenceRefs: Array.from(new Set(rule.evidenceRefs.map((ref) => (
      resolveMaterialRange(input.library, ref)?.displayRef ?? ref.trim()
    )))),
  }))
  const seenExamples = new Set<string>()
  const examples = input.result.exampleCandidates.flatMap((example) => {
    const resolved = resolveMaterialRange(input.library, example.ref)
    if (!resolved || seenExamples.has(resolved.displayRef)) return []
    if (!findContainingCandidate(resolved.displayRef, input.candidates, input.library)) return []
    seenExamples.add(resolved.displayRef)
    return [{ ...example, ref: resolved.displayRef }]
  })
  return { ...input.result, rules, exampleCandidates: examples }
}

function candidateFromDisplayRef(
  library: MaterialLibrary,
  displayRef: string,
  aspect = '已有技巧卡证据',
) {
  const resolved = resolveMaterialRange(library, displayRef)
  if (!resolved) return null
  return {
    rangeRef: resolved.rangeRef,
    displayRef: resolved.displayRef,
    chapterId: resolved.start.chapterId,
    chapterIndex: resolved.start.chapterIndex,
    startParagraphIndex: resolved.start.paragraphIndex,
    endParagraphIndex: resolved.end.paragraphIndex,
    aspect,
    relevance: 1,
  } satisfies ValidatedCandidateRange
}

export class WritingSkillDistillationAgent {
  constructor(private readonly dependencies: {
    gateway?: ModelGateway
    db?: WritingSkillStoreDb
    loadLibrary?: (libraryId: string) => MaterialLibrary
  } = {}) {}

  private get gateway() {
    return this.dependencies.gateway ?? new ConfiguredWritingSkillModelGateway()
  }

  private loadLibrary(libraryId: string) {
    return (this.dependencies.loadLibrary ?? loadMaterialLibrary)(libraryId)
  }

  private assertActive(jobId: string) {
    const job = readWritingSkillJob(jobId, this.dependencies.db)
    if (!job || job.status === 'CANCELLED') throw new CancelledWritingSkillJobError()
    return job
  }

  async run(jobId: string) {
    const initialJob = readWritingSkillJob(jobId, this.dependencies.db)
    if (!initialJob) throw new Error('Writing skill distillation job not found')
    if (initialJob.status === 'CANCELLED') return initialJob
    const request = readWritingSkillJobRequest(jobId, this.dependencies.db) ?? {}
    let inputTokens = initialJob.inputTokens
    let outputTokens = initialJob.outputTokens

    try {
      updateWritingSkillJob(jobId, {
        status: 'INSPECTING_LIBRARY',
        message: '正在检查素材库……',
        errorMessage: null,
      }, this.dependencies.db)
      const sourceRefs = normalizeWritingSkillSourceRefs(request.sourceRefs)
      const materialSelection = sourceRefs.length
        ? loadWritingSkillMaterialCollection(sourceRefs, {
            db: this.dependencies.db,
            loadLibrary: (libraryId) => this.loadLibrary(libraryId),
          })
        : (() => {
            const library = this.loadLibrary(initialJob.libraryId)
            return {
              library,
              sources: [{
                sourceType: 'LIBRARY' as const,
                sourceId: library.id,
                sourceVersion: library.version,
                sourceName: library.name,
                sourceOrder: 0,
              }],
            }
          })()
      const { library, sources } = materialSelection
      markWritingSkillCardsStaleForLibraryVersion(library.id, library.version, this.dependencies.db)
      updateWritingSkillJob(jobId, { libraryVersion: library.version }, this.dependencies.db)
      this.assertActive(jobId)

      const capabilities = await this.gateway.getCapabilities(initialJob.modelConfigId)
      const scanContextWindow = normalizeWritingSkillContextWindow(request.scanContextWindow)
      const scanTotalBudget = normalizeWritingSkillTotalBudget(request.scanTotalBudget)
      const scanChunkBudget = calculateWritingSkillScanChunkBudget(capabilities, scanContextWindow)
      const totalScanBudget = resolveWritingSkillTotalBudget(scanTotalBudget)
      if (scanChunkBudget <= 0) throw new Error('当前模型上下文不足以执行素材扫描')

      const replaceCardId = typeof request.replaceCardId === 'string' ? request.replaceCardId.trim() : ''
      const refineInstruction = typeof request.refineInstruction === 'string'
        ? request.refineInstruction.trim()
        : ''
      let candidates: ValidatedCandidateRange[] = []
      let hasSufficientCoverage = Boolean(refineInstruction)
      const sampledRanges = initialJob.sampledRanges.slice()

      if (refineInstruction) {
        const existing = replaceCardId ? readWritingSkillCardDetail(replaceCardId, this.dependencies.db) : null
        if (!existing) throw new Error('要调整的写作技巧卡不存在')
        if (existing.libraryId !== library.id || existing.libraryVersion !== library.version) {
          throw new InsufficientWritingSkillEvidenceError('已有技巧卡的素材版本已经过期，请使用“换一批素材重做”')
        }
        const refs = Array.from(new Set([
          ...existing.rules.flatMap((rule) => rule.evidenceRefs),
          ...existing.examples.map((example) => example.displayRef),
        ]))
        candidates = mergeWritingSkillCandidateRanges(
          refs.map((ref) => candidateFromDisplayRef(library, ref)).filter((candidate): candidate is ValidatedCandidateRange => candidate !== null),
        )
        if (candidates.length < WRITING_SKILL_DEFAULTS.minExamplePoolSize) {
          throw new InsufficientWritingSkillEvidenceError('已有证据不足以安全调整，请使用“换一批素材重做”')
        }
        updateWritingSkillJob(jobId, {
          roundCount: 0,
          candidateRefs: candidates.map((candidate) => candidate.displayRef),
        }, this.dependencies.db)
      } else {
        const excludedChapterIds = new Set<string>()
        let scannedTokens = 0
        let effectiveScanChunkBudget = scanChunkBudget
        for (let round = 1; round <= WRITING_SKILL_DEFAULTS.maxScanRounds; round += 1) {
          this.assertActive(jobId)
          const remainingBudget = totalScanBudget === null
            ? effectiveScanChunkBudget
            : Math.min(effectiveScanChunkBudget, totalScanBudget - scannedTokens)
          if (remainingBudget <= 0) break
          const roundSeed = deriveWritingSkillRoundSeed(initialJob.randomSeed, round)
          updateWritingSkillJob(jobId, {
            status: 'SAMPLING_MATERIAL',
            message: round === 1 ? '正在阅读选中的章节……' : `正在换一批素材继续寻找（第 ${round} 轮）……`,
          }, this.dependencies.db)
          let attemptBudget = remainingBudget
          let sample = sampleWritingSkillMaterial({
            library,
            tokenBudget: attemptBudget,
            seed: roundSeed,
            excludedChapterIds: Array.from(excludedChapterIds),
          })
          if (!sample.paragraphs.length) break
          let scan: StructuredGenerationResult<MaterialScanResult> | null = null
          let validRoundCandidates: ValidatedCandidateRange[] = []
          for (let attempt = 1; attempt <= WRITING_SKILL_DEFAULTS.maxAdaptiveScanRetries; attempt += 1) {
            updateWritingSkillJob(jobId, {
              status: 'SCANNING_MATERIAL',
              message: attempt === 1
                ? '正在从素材库中寻找相关写法……'
                : `正在缩小本轮素材并自动修复（第 ${attempt} 次）……`,
            }, this.dependencies.db)
            const prompt = buildMaterialScanPrompt({
              userInstruction: initialJob.userInstruction,
              numberedMaterial: compileNumberedMaterial(sample.paragraphs),
            })
            const allowedRefs = sample.paragraphs.map((paragraph) => paragraph.displayRef)
            try {
              scan = await this.gateway.generateStructured<MaterialScanResult>({
                modelConfigId: initialJob.modelConfigId,
                messages: [
                  { role: 'system', content: prompt.system },
                  { role: 'user', content: prompt.user },
                ],
                schemaName: 'writing_skill_material_scan',
                schema: buildMaterialScanJsonSchema(allowedRefs) as unknown as Record<string, unknown>,
                runtimeSchema: buildMaterialScanRuntimeSchema(allowedRefs),
                maxOutputTokens: WRITING_SKILL_DEFAULTS.expectedScanOutputTokens,
                temperature: WRITING_SKILL_DEFAULTS.scanTemperature,
              })
            } catch (error) {
              const nextBudget = Math.floor(attemptBudget / 2)
              if (
                !isWritingSkillContextLimitError(error)
                || attempt >= WRITING_SKILL_DEFAULTS.maxAdaptiveScanRetries
                || nextBudget < WRITING_SKILL_DEFAULTS.minAdaptiveScanBudget
              ) {
                throw error
              }
              attemptBudget = nextBudget
              effectiveScanChunkBudget = Math.min(effectiveScanChunkBudget, attemptBudget)
              sample = sampleWritingSkillMaterial({
                library,
                tokenBudget: attemptBudget,
                seed: roundSeed,
                excludedChapterIds: Array.from(excludedChapterIds),
              })
              if (!sample.paragraphs.length) throw error
              continue
            }
            inputTokens += scan.usage.inputTokens
            outputTokens += scan.usage.outputTokens
            scannedTokens += sample.estimatedTokens
            validRoundCandidates = validateWritingSkillScanResult({
              library,
              sample,
              result: scan.data,
            })
            const totalRemaining = totalScanBudget === null
              ? Number.POSITIVE_INFINITY
              : totalScanBudget - scannedTokens
            const nextBudget = Math.min(Math.floor(attemptBudget / 2), totalRemaining)
            const shouldRetryEmptyLargeSample = validRoundCandidates.length === 0
              && sample.estimatedTokens >= WRITING_SKILL_DEFAULTS.zeroCandidateRetryThreshold
              && attempt < WRITING_SKILL_DEFAULTS.maxAdaptiveScanRetries
              && nextBudget >= WRITING_SKILL_DEFAULTS.minAdaptiveScanBudget
            if (!shouldRetryEmptyLargeSample) break
            attemptBudget = nextBudget
            effectiveScanChunkBudget = Math.min(effectiveScanChunkBudget, attemptBudget)
            sample = sampleWritingSkillMaterial({
              library,
              tokenBudget: attemptBudget,
              seed: roundSeed,
              excludedChapterIds: Array.from(excludedChapterIds),
            })
            if (!sample.paragraphs.length) break
          }
          if (!scan) throw new Error('素材扫描未返回有效结果')
          sampledRanges.push(toSampledRangeRecord(sample, round, roundSeed))
          updateWritingSkillJob(jobId, { roundCount: round, sampledRanges }, this.dependencies.db)
          candidates = mergeWritingSkillCandidateRanges([...candidates, ...validRoundCandidates])
          hasSufficientCoverage ||= scan.data.coverage === 'sufficient'
          updateWritingSkillJob(jobId, {
            status: 'CHECKING_COVERAGE',
            message: `已累计阅读约 ${scannedTokens.toLocaleString()} token，找到 ${candidates.length} 组相关段落……`,
            candidateRefs: candidates.map((candidate) => candidate.displayRef),
            inputTokens,
            outputTokens,
          }, this.dependencies.db)
          for (const chapterId of sample.chapterIds) excludedChapterIds.add(chapterId)
          if (sample.mode === 'full') break
        }
      }

      const minimumRequiredCandidates = refineInstruction
        ? WRITING_SKILL_DEFAULTS.minExamplePoolSize
        : WRITING_SKILL_DEFAULTS.minCandidates
      if (!hasSufficientCoverage || candidates.length < minimumRequiredCandidates) {
        throw new InsufficientWritingSkillEvidenceError(
          `这个素材库中没有找到足够多与“${initialJob.userInstruction}”相关的代表性内容。可以换一个方向，或者换一批素材重新尝试。`,
        )
      }
      this.assertActive(jobId)
      updateWritingSkillJob(jobId, {
        status: 'FETCHING_EVIDENCE',
        message: '正在读取代表性段落……',
        candidateRefs: candidates.map((candidate) => candidate.displayRef),
        inputTokens,
        outputTokens,
      }, this.dependencies.db)
      const evidenceRanges = selectWritingSkillEvidenceRanges(
        candidates,
        WRITING_SKILL_DEFAULTS.maxDistillRanges,
      )
      const allowedEvidenceRefs = evidenceRanges.map((candidate) => candidate.displayRef)
      const evidenceMaterial = compileEvidenceMaterial(library, evidenceRanges)

      const distill = async (validationIssues?: string[]) => {
        updateWritingSkillJob(jobId, {
          status: 'DISTILLING_SKILL',
          message: validationIssues?.length ? '正在修复技巧总结……' : '正在整理写作技巧……',
        }, this.dependencies.db)
        const prompt = buildSkillDistillationPrompt({
          libraryName: library.name,
          userInstruction: initialJob.userInstruction,
          evidenceMaterial,
          refineInstruction,
          validationIssues,
        })
        const generated = await this.gateway.generateStructured<SkillDistillationResult>({
          modelConfigId: initialJob.modelConfigId,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          schemaName: 'writing_skill_distillation',
          schema: buildSkillDistillationJsonSchema(allowedEvidenceRefs) as unknown as Record<string, unknown>,
          runtimeSchema: buildSkillDistillationRuntimeSchema(allowedEvidenceRefs),
          maxOutputTokens: WRITING_SKILL_DEFAULTS.expectedDistillOutputTokens,
          temperature: WRITING_SKILL_DEFAULTS.distillTemperature,
        })
        inputTokens += generated.usage.inputTokens
        outputTokens += generated.usage.outputTokens
        return normalizeValidatedDistillationResult({
          result: generated.data,
          candidates: evidenceRanges,
          library,
        })
      }

      let result = await distill()
      updateWritingSkillJob(jobId, {
        status: 'VALIDATING_RESULT',
        message: '正在验证技巧与证据引用……',
        inputTokens,
        outputTokens,
      }, this.dependencies.db)
      let validationIssues = validateDistillationResult({ result, candidates: evidenceRanges, library })
      if (validationIssues.length) {
        result = await distill(validationIssues)
        updateWritingSkillJob(jobId, {
          status: 'VALIDATING_RESULT',
          message: '正在验证修复后的技巧总结……',
          inputTokens,
          outputTokens,
        }, this.dependencies.db)
        validationIssues = validateDistillationResult({ result, candidates: evidenceRanges, library })
      }
      if (validationIssues.length) {
        throw new Error(`技巧总结未通过验证：${validationIssues.join('；')}`)
      }

      this.assertActive(jobId)
      updateWritingSkillJob(jobId, {
        status: 'SAVING_SKILL_CARD',
        message: '正在保存写作技巧卡……',
        inputTokens,
        outputTokens,
      }, this.dependencies.db)
      const examples = result.exampleCandidates.flatMap((example) => {
        const resolved = resolveMaterialRange(library, example.ref)
        return resolved ? [{
          rangeRef: resolved.rangeRef,
          displayRef: resolved.displayRef,
          score: example.score,
        }] : []
      })
      const card = await saveWritingSkillCard({
        libraryId: library.id,
        libraryVersion: library.version,
        libraryName: library.name,
        userInstruction: initialJob.userInstruction,
        modelConfigId: initialJob.modelConfigId,
        sourceJobId: jobId,
        result,
        examples,
        sources,
        replaceCardId: replaceCardId || null,
      }, this.dependencies.db)
      updateWritingSkillJob(jobId, {
        status: 'COMPLETED',
        message: '写作技巧卡已完成',
        resultCardId: card.id,
        inputTokens,
        outputTokens,
        errorMessage: null,
      }, this.dependencies.db)
      return readWritingSkillJob(jobId, this.dependencies.db)!
    } catch (error) {
      if (error instanceof CancelledWritingSkillJobError) {
        return readWritingSkillJob(jobId, this.dependencies.db)
      }
      if (error instanceof InsufficientWritingSkillEvidenceError) {
        updateWritingSkillJob(jobId, {
          status: 'INSUFFICIENT_EVIDENCE',
          message: error.message,
          errorMessage: error.message,
          inputTokens,
          outputTokens,
        }, this.dependencies.db)
        return readWritingSkillJob(jobId, this.dependencies.db)
      }
      const message = error instanceof Error ? error.message : '写作技巧蒸馏失败'
      updateWritingSkillJob(jobId, {
        status: 'FAILED',
        message: '写作技巧蒸馏失败',
        errorMessage: message,
        inputTokens,
        outputTokens,
      }, this.dependencies.db)
      return readWritingSkillJob(jobId, this.dependencies.db)
    }
  }
}
