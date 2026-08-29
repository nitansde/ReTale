import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { createDatabaseAccess, type DatabaseAccess } from '@/lib/server/database-access'
import { initializeDatabase } from '@/lib/server/sqlite'
import { CONTROL_SCHEMA_SQL } from '@/lib/server/schema'
import { WritingSkillDistillationAgent } from '@/lib/server/writing-skill-distillation-agent'
import type {
  ModelGateway,
  StructuredGenerationResult,
  WritingSkillChatMessage,
} from '@/lib/server/writing-skill-model-gateway'
import { formatMaterialParagraphRef, type MaterialLibrary } from '@/lib/server/writing-skill-material'
import { loadWritingSkillMaterialCollection } from '@/lib/server/writing-skill-sources'
import {
  resolveWritingSkillCardDetail,
  resolveWritingSkillRuntime,
  selectSkillExamples,
} from '@/lib/server/writing-skill-runtime'
import {
  createWritingSkillJob,
  deleteWritingSkillCard,
  readWritingSkillCardDetail,
  readWritingSkillJob,
  saveWritingSkillCard,
  updateWritingSkillCard,
} from '@/lib/server/writing-skill-store'
import type {
  MaterialParagraph,
  MaterialScanResult,
  SkillDistillationResult,
} from '@/lib/writing-skill-types'
import type {
  WritingSkillContextWindow,
  WritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function createTestDb(prefix: string) {
  const temp = createTempDatabaseCopy(prefix)
  const database = initializeDatabase(new DatabaseSync(temp.dbPath), { mode: 'control', schemaSql: CONTROL_SCHEMA_SQL })
  cleanups.push(() => {
    database.close()
    temp.cleanup()
  })
  return { db: createDatabaseAccess(database), database }
}

function createLibrary(input: {
  chapterCount: number
  paragraphsPerChapter?: number
  estimatedTokens: number
  version?: string
  textPrefix?: string
  libraryId?: string
  name?: string
}) {
  const libraryId = input.libraryId ?? 'library-1'
  const version = input.version ?? 'library-version-1'
  const paragraphsPerChapter = input.paragraphsPerChapter ?? 1
  const paragraphs: MaterialParagraph[] = Array.from({ length: input.chapterCount }, (_, index) => {
    const chapterIndex = index + 1
    return Array.from({ length: paragraphsPerChapter }, (_, paragraphOffset) => {
      const paragraphIndex = paragraphOffset + 1
      const displayRef = formatMaterialParagraphRef(chapterIndex, paragraphIndex)
      return {
        id: paragraphsPerChapter === 1
          ? `${libraryId === 'library-1' ? '' : `${libraryId}:`}paragraph-${chapterIndex}`
          : `${libraryId === 'library-1' ? '' : `${libraryId}:`}paragraph-${chapterIndex}-${paragraphIndex}`,
        libraryId,
        libraryVersion: version,
        workId: libraryId === 'library-1' ? 'work-1' : `${libraryId}:work`,
        chapterId: `${libraryId === 'library-1' ? '' : `${libraryId}:`}chapter-${chapterIndex}`,
        chapterIndex,
        paragraphIndex,
        anonymizedText: `${input.textPrefix ?? '匿名化叙事材料'} ${paragraphsPerChapter === 1 ? chapterIndex : `${chapterIndex}-${paragraphIndex}`}，只用于测试证据读取。`,
        estimatedTokens: input.estimatedTokens,
        displayRef,
      }
    })
  }).flat()
  return {
    id: libraryId,
    version,
    name: input.name ?? '作者甲素材库',
    author: '作者甲',
    workId: libraryId === 'library-1' ? 'work-1' : `${libraryId}:work`,
    paragraphs,
    totalTokens: paragraphs.reduce((sum, paragraph) => sum + paragraph.estimatedTokens, 0),
    chapterIds: paragraphs.map((paragraph) => paragraph.chapterId),
    paragraphByDisplayRef: new Map(paragraphs.map((paragraph) => [paragraph.displayRef, paragraph])),
    paragraphById: new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph])),
  } satisfies MaterialLibrary
}

function refsFromNumberedMaterial(content: string) {
  return Array.from(content.matchAll(/^\[(W\d+-C\d+-P\d+)\]$/gm), (match) => match[1])
}

function refsFromEvidence(content: string) {
  return Array.from(content.matchAll(/^=== EVIDENCE \d+: ([^ /]+) \/ /gm), (match) => match[1])
}

function createDistillationResult(refs: string[]): SkillDistillationResult {
  const examples = refs.slice(0, 6)
  return {
    title: '作者甲 · 五官描写',
    summary: '这张技巧卡概括素材中反复出现的组织方式：先选择少量具有辨识度的细节，再让观察顺序、动作变化、环境反馈与人物当下情绪互相支撑，使描写服务于叙事推进而不是停留在静态罗列。这样的处理会保留人物既定设定，并将抽象判断转化为可执行的写作步骤。',
    rules: Array.from({ length: 4 }, (_, index) => ({
      text: `写作方法 ${index + 1}：围绕叙事目的组织细节并保持信息递进。`,
      evidenceRefs: [refs[index % refs.length]],
    })),
    applicationScope: '适用于人物出场、近距离观察、视线互动和情绪发生转折的段落。',
    avoid: ['避免依次罗列全部五官', '避免复制素材中的独特措辞'],
    exampleCandidates: examples.map((ref, index) => ({
      ref,
      score: 0.95 - index * 0.03,
    })),
    confidence: 0.9,
  }
}

function createGateway(input: {
  contextWindow: number
  scan: (refs: string[], scanIndex: number) => MaterialScanResult
}) {
  const scanCalls: string[][] = []
  let distillCalls = 0
  const gateway: ModelGateway = {
    getCapabilities: async () => ({
      contextWindow: input.contextWindow,
      maxOutputTokens: 1024,
      supportsStructuredOutput: true,
      supportsToolCalling: false,
    }),
    generateStructured: async <T,>(options: {
      modelConfigId: string
      messages: WritingSkillChatMessage[]
      schemaName: string
      schema: Record<string, unknown>
      runtimeSchema: z.ZodType<T>
      maxOutputTokens: number
      temperature?: number
      signal?: AbortSignal
    }): Promise<StructuredGenerationResult<T>> => {
      const userContent = options.messages.find((message) => message.role === 'user')?.content ?? ''
      if (options.schemaName === 'writing_skill_material_scan') {
        const refs = refsFromNumberedMaterial(userContent)
        scanCalls.push(refs)
        return {
          data: input.scan(refs, scanCalls.length - 1) as T,
          usage: { inputTokens: refs.length * 10, outputTokens: 20 },
        }
      }
      const refs = refsFromEvidence(userContent)
      distillCalls += 1
      return {
        data: createDistillationResult(refs) as T,
        usage: { inputTokens: refs.length * 12, outputTokens: 40 },
      }
    },
  }
  return { gateway, scanCalls, getDistillCalls: () => distillCalls }
}

async function runAgent(input: {
  db: DatabaseAccess
  library: MaterialLibrary
  gateway: ModelGateway
  seed?: number
  scanContextWindow?: WritingSkillContextWindow
  scanTotalBudget?: WritingSkillTotalBudget
}) {
  const job = createWritingSkillJob({
    libraryId: input.library.id,
    instruction: '五官',
    modelConfigId: 'knowledgeExtraction',
    randomSeed: input.seed ?? 12345,
    ...(input.scanContextWindow || input.scanTotalBudget ? {
      request: {
        ...(input.scanContextWindow ? { scanContextWindow: input.scanContextWindow } : {}),
        ...(input.scanTotalBudget ? { scanTotalBudget: input.scanTotalBudget } : {}),
      },
    } : {}),
  }, input.db)
  const result = await new WritingSkillDistillationAgent({
    db: input.db,
    gateway: input.gateway,
    loadLibrary: () => input.library,
  }).run(job.id)
  return readWritingSkillJob(result!.id, input.db)!
}

describe('WritingSkillDistillationAgent workflows', () => {
  it('fully reads a small library, scans once, distills once, and stores references only', async () => {
    const { db, database } = createTestDb('retale-writing-skill-small')
    const library = createLibrary({ chapterCount: 8, estimatedTokens: 20 })
    const mock = createGateway({
      contextWindow: 32_000,
      scan: (refs) => ({
        normalizedTopic: '人物五官与面部神态',
        coverage: 'sufficient',
        candidates: refs.map((ref, index) => ({
          startRef: ref,
          endRef: ref,
          aspect: `角度-${index + 1}`,
          relevance: 0.95 - index * 0.01,
        })),
      }),
    })

    const job = await runAgent({ db, library, gateway: mock.gateway })
    expect(job.status).toBe('COMPLETED')
    expect(job.roundCount).toBe(1)
    expect(job.sampledRanges).toHaveLength(1)
    expect(job.sampledRanges[0].mode).toBe('full')
    expect(mock.scanCalls).toHaveLength(1)
    expect(mock.getDistillCalls()).toBe(1)

    const card = readWritingSkillCardDetail(job.resultCardId!, db)!
    expect(card.rules.every((rule) => rule.evidenceRefs.length > 0)).toBe(true)
    expect(card.examples).toHaveLength(6)
    expect(card.examples.every((example) => example.rangeRef.libraryVersion === library.version)).toBe(true)

    const cardColumns = database.prepare('PRAGMA table_info(WritingSkillCard)').all() as Array<{ name: string }>
    const exampleColumns = database.prepare('PRAGMA table_info(WritingSkillExample)').all() as Array<{ name: string }>
    expect(cardColumns.map((column) => column.name)).not.toContain('sourceText')
    expect(exampleColumns.map((column) => column.name)).not.toContain('sourceText')
    const persistedExamples = database.prepare('SELECT rangeRefJson, displayRef FROM WritingSkillExample').all()
    expect(JSON.stringify(persistedExamples)).not.toContain(library.paragraphs[0].anonymizedText)

    const detail = resolveWritingSkillCardDetail({ cardId: card.id, db, library })!
    expect(detail.examples[0].anonymizedText).toBe(library.paragraphs[0].anonymizedText)
    const runtime = resolveWritingSkillRuntime({ cardId: card.id, count: 2, seed: 77, db, library })
    expect(runtime.examples).toHaveLength(2)
    expect(runtime.prompt).toContain(runtime.examples[0].anonymizedText)
    expect(runtime.prompt).not.toContain(runtime.examples[0].displayRef)
  })

  it('distills one global skill card from multiple selected books and preserves both source records', async () => {
    const { db } = createTestDb('retale-writing-skill-multi-source')
    const first = createLibrary({ chapterCount: 4, estimatedTokens: 20, libraryId: 'library-a', name: '作品甲' })
    const second = createLibrary({ chapterCount: 4, estimatedTokens: 20, libraryId: 'library-b', name: '作品乙' })
    const libraries = new Map([[first.id, first], [second.id, second]])
    const sourceRefs = [
      { sourceType: 'LIBRARY' as const, sourceId: first.id },
      { sourceType: 'LIBRARY' as const, sourceId: second.id },
    ]
    const collection = loadWritingSkillMaterialCollection(sourceRefs, {
      loadLibrary: (libraryId) => libraries.get(libraryId)!,
    })
    const mock = createGateway({
      contextWindow: 32_000,
      scan: (refs) => ({
        normalizedTopic: '人物五官与面部神态',
        coverage: 'sufficient',
        candidates: refs.map((ref, index) => ({
          startRef: ref,
          endRef: ref,
          aspect: `多书角度-${index + 1}`,
          relevance: 0.95 - index * 0.01,
        })),
      }),
    })
    const job = createWritingSkillJob({
      libraryId: collection.library.id,
      instruction: '五官',
      modelConfigId: 'knowledgeExtraction',
      randomSeed: 777,
      request: { sourceRefs },
    }, db)
    const completed = await new WritingSkillDistillationAgent({
      db,
      gateway: mock.gateway,
      loadLibrary: (libraryId) => libraries.get(libraryId)!,
    }).run(job.id)

    expect(completed?.status).toBe('COMPLETED')
    const card = readWritingSkillCardDetail(completed!.resultCardId!, db)!
    expect(card.libraryId).toBe(collection.library.id)
    expect(card.sources?.map((source) => source.sourceName)).toEqual(['作品甲', '作品乙'])
    expect(card.examples.some((example) => example.displayRef.startsWith('W01-'))).toBe(true)
    expect(card.examples.some((example) => example.displayRef.startsWith('W02-'))).toBe(true)
    const detail = resolveWritingSkillCardDetail({ cardId: card.id, db, library: collection.library })!
    expect(detail.examples.every((example) => example.anonymizedText)).toBe(true)
  })

  it('shows adjacent context without allowing the model to cite those paragraph refs', async () => {
    const { db } = createTestDb('retale-writing-skill-context-citations')
    const library = createLibrary({ chapterCount: 8, paragraphsPerChapter: 3, estimatedTokens: 20 })
    let distillPrompt = ''
    let distillSchema: Record<string, unknown> | null = null
    const gateway: ModelGateway = {
      getCapabilities: async () => ({
        contextWindow: 32_000,
        maxOutputTokens: 4096,
        supportsStructuredOutput: true,
        supportsToolCalling: false,
      }),
      generateStructured: async <T,>(options: {
        modelConfigId: string
        messages: WritingSkillChatMessage[]
        schemaName: string
        schema: Record<string, unknown>
        runtimeSchema: z.ZodType<T>
        maxOutputTokens: number
        temperature?: number
        signal?: AbortSignal
      }): Promise<StructuredGenerationResult<T>> => {
        const userContent = options.messages.find((message) => message.role === 'user')?.content ?? ''
        if (options.schemaName === 'writing_skill_material_scan') {
          const refs = refsFromNumberedMaterial(userContent).filter((ref) => ref.endsWith('-P002'))
          return {
            data: {
              normalizedTopic: '人物五官与面部神态',
              coverage: 'sufficient',
              candidates: refs.map((ref, index) => ({
                startRef: ref,
                endRef: ref,
                aspect: `核心证据-${index + 1}`,
                relevance: 0.95 - index * 0.01,
              })),
            } as T,
            usage: { inputTokens: 10, outputTokens: 10 },
          }
        }
        distillPrompt = userContent
        distillSchema = options.schema
        return {
          data: createDistillationResult(refsFromEvidence(userContent)) as T,
          usage: { inputTokens: 10, outputTokens: 10 },
        }
      },
    }

    const job = await runAgent({ db, library, gateway })
    expect(job.status).toBe('COMPLETED')
    expect(distillPrompt).toContain('[CONTEXT BEFORE — NOT CITABLE]')
    expect(distillPrompt).toContain('[CONTEXT AFTER — NOT CITABLE]')
    expect(distillPrompt).not.toContain('[W01-C001-P001]')
    expect(distillPrompt).not.toContain('[W01-C001-P003]')
    const schemaText = JSON.stringify(distillSchema)
    expect(schemaText).toContain('W01-C001-P002')
    expect(schemaText).not.toContain('W01-C001-P001')
    expect(schemaText).not.toContain('W01-C001-P003')
  })

  it('samples non-overlapping rounds until material exhaustion and remains seed-reproducible', async () => {
    const firstDb = createTestDb('retale-writing-skill-large-first').db
    const library = createLibrary({ chapterCount: 15, estimatedTokens: 200 })
    const createLargeGateway = () => createGateway({
      contextWindow: 4096,
      scan: (refs, scanIndex) => ({
        normalizedTopic: '人物五官与面部神态',
        coverage: scanIndex >= 2 ? 'sufficient' : 'insufficient',
        candidates: refs.slice(0, 3).map((ref, index) => ({
          startRef: ref,
          endRef: ref,
          aspect: `轮次角度-${scanIndex + 1}-${index + 1}`,
          relevance: 0.9 - index * 0.02,
        })),
      }),
    })
    const firstMock = createLargeGateway()
    const firstJob = await runAgent({ db: firstDb, library, gateway: firstMock.gateway, seed: 98765 })

    expect(firstJob.status).toBe('COMPLETED')
    expect(firstJob.roundCount).toBe(3)
    expect(firstJob.sampledRanges).toHaveLength(3)
    expect(firstJob.sampledRanges.every((sample) => sample.mode === 'sampled')).toBe(true)
    const allChapterIds = firstJob.sampledRanges.flatMap((sample) => sample.chapterIds)
    expect(new Set(allChapterIds).size).toBe(allChapterIds.length)
    expect(firstJob.sampledRanges.every((sample) => sample.estimatedTokens <= 1381)).toBe(true)

    const secondDb = createTestDb('retale-writing-skill-large-second').db
    const secondMock = createLargeGateway()
    const secondJob = await runAgent({ db: secondDb, library, gateway: secondMock.gateway, seed: 98765 })
    expect(secondJob.sampledRanges.map((sample) => sample.displayRefs)).toEqual(
      firstJob.sampledRanges.map((sample) => sample.displayRefs),
    )
  })

  it('uses multiple non-overlapping calls when total reading budget exceeds the selected context tier', async () => {
    const { db } = createTestDb('retale-writing-skill-user-budget')
    const library = createLibrary({ chapterCount: 400, estimatedTokens: 400 })
    const mock = createGateway({
      contextWindow: 200_000,
      scan: (refs) => ({
        normalizedTopic: '人物五官与面部神态',
        coverage: 'sufficient',
        candidates: refs.slice(0, 24).map((ref, index) => ({
          startRef: ref,
          endRef: ref,
          aspect: `预算证据-${index + 1}`,
          relevance: 0.95 - index * 0.01,
        })),
      }),
    })

    const job = await runAgent({
      db,
      library,
      gateway: mock.gateway,
      scanContextWindow: '32k',
      scanTotalBudget: '128k',
    })
    const sampledTokens = job.sampledRanges.reduce((sum, sample) => sum + sample.estimatedTokens, 0)
    const sampledChapterIds = job.sampledRanges.flatMap((sample) => sample.chapterIds)
    expect(job.status).toBe('COMPLETED')
    expect(job.roundCount).toBeGreaterThan(1)
    expect(job.sampledRanges.every((sample) => sample.mode === 'sampled')).toBe(true)
    expect(job.sampledRanges.every((sample) => sample.estimatedTokens <= 25_936)).toBe(true)
    expect(sampledTokens).toBeGreaterThan(25_936)
    expect(sampledTokens).toBeLessThanOrEqual(128_000)
    expect(new Set(sampledChapterIds).size).toBe(sampledChapterIds.length)
    expect(job.candidateCount).toBeGreaterThanOrEqual(24)
  })

  it('automatically reduces an oversized context chunk and continues after a provider context-limit error', async () => {
    const { db } = createTestDb('retale-writing-skill-context-fallback')
    const library = createLibrary({ chapterCount: 400, estimatedTokens: 400 })
    const mock = createGateway({
      contextWindow: 200_000,
      scan: (refs) => {
        if (refs.length > 100) throw new Error('maximum context length exceeded')
        return {
          normalizedTopic: '人物五官与面部神态',
          coverage: 'sufficient',
          candidates: refs.slice(0, 24).map((ref, index) => ({
            startRef: ref,
            endRef: ref,
            aspect: `降档证据-${index + 1}`,
            relevance: 0.95 - index * 0.01,
          })),
        }
      },
    })

    const job = await runAgent({
      db,
      library,
      gateway: mock.gateway,
      scanContextWindow: '128k',
      scanTotalBudget: '128k',
    })

    expect(job.status).toBe('COMPLETED')
    expect(mock.scanCalls[0].length).toBeGreaterThan(100)
    expect(mock.scanCalls[1].length).toBeGreaterThan(100)
    expect(mock.scanCalls[2].length).toBeLessThanOrEqual(100)
    expect(job.sampledRanges.every((sample) => sample.estimatedTokens <= 26_880)).toBe(true)
  })

  it('automatically rechecks a large zero-candidate scan with smaller material instead of reporting false insufficiency', async () => {
    const { db } = createTestDb('retale-writing-skill-empty-scan-repair')
    const library = createLibrary({ chapterCount: 400, estimatedTokens: 400 })
    const mock = createGateway({
      contextWindow: 200_000,
      scan: (refs, scanIndex) => scanIndex === 0
        ? {
            normalizedTopic: '人物五官与面部神态',
            coverage: 'insufficient',
            candidates: [],
          }
        : {
            normalizedTopic: '人物五官与面部神态',
            coverage: 'sufficient',
            candidates: refs.slice(0, 24).map((ref, index) => ({
              startRef: ref,
              endRef: ref,
              aspect: `复查证据-${index + 1}`,
              relevance: 0.95 - index * 0.01,
            })),
          },
    })

    const job = await runAgent({
      db,
      library,
      gateway: mock.gateway,
      scanContextWindow: '128k',
      scanTotalBudget: '256k',
    })

    expect(job.status).toBe('COMPLETED')
    expect(mock.scanCalls.length).toBeGreaterThan(1)
    expect(mock.scanCalls[1].length).toBeLessThan(mock.scanCalls[0].length)
    expect(job.candidateCount).toBeGreaterThanOrEqual(24)
  })

  it('returns INSUFFICIENT_EVIDENCE for an irrelevant library and never distills a generic tutorial', async () => {
    const { db, database } = createTestDb('retale-writing-skill-irrelevant')
    const library = createLibrary({ chapterCount: 9, estimatedTokens: 20, textPrefix: '安静日常素材' })
    const mock = createGateway({
      contextWindow: 32_000,
      scan: () => ({
        normalizedTopic: '战斗速度感',
        coverage: 'insufficient',
        candidates: [],
      }),
    })

    const job = await runAgent({ db, library, gateway: mock.gateway })
    expect(job.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(job.errorMessage).toContain('没有找到足够多')
    expect(mock.scanCalls).toHaveLength(1)
    expect(mock.getDistillCalls()).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM WritingSkillCard').get()).toEqual({ count: 0 })
  })

  it('honors explicit insufficient coverage even when a full-library scan returns enough raw references', async () => {
    const { db } = createTestDb('retale-writing-skill-explicit-insufficient')
    const library = createLibrary({ chapterCount: 8, estimatedTokens: 20 })
    const mock = createGateway({
      contextWindow: 32_000,
      scan: (refs) => ({
        normalizedTopic: '人物五官与面部神态',
        coverage: 'insufficient',
        candidates: refs.map((ref, index) => ({
          startRef: ref,
          endRef: ref,
          aspect: `弱证据-${index + 1}`,
          relevance: 0.7,
        })),
      }),
    })

    const job = await runAgent({ db, library, gateway: mock.gateway })
    expect(job.candidateCount).toBe(8)
    expect(job.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(mock.getDistillCalls()).toBe(0)
  })

  it('refines an existing card from its saved evidence without rescanning the library', async () => {
    const { db } = createTestDb('retale-writing-skill-refine')
    const library = createLibrary({ chapterCount: 8, estimatedTokens: 20 })
    const initialResult = createDistillationResult(library.paragraphs.map((paragraph) => paragraph.displayRef))
    const existing = await saveWritingSkillCard({
      libraryId: library.id,
      libraryVersion: library.version,
      libraryName: library.name,
      userInstruction: '五官',
      modelConfigId: 'knowledgeExtraction',
      sourceJobId: 'source-job',
      result: initialResult,
      examples: initialResult.exampleCandidates.map((example, index) => ({
        rangeRef: {
          libraryId: library.id,
          libraryVersion: library.version,
          workId: library.workId,
          chapterId: `chapter-${index + 1}`,
          startParagraphId: `paragraph-${index + 1}`,
          endParagraphId: `paragraph-${index + 1}`,
        },
        displayRef: example.ref,
        score: example.score,
      })),
    }, db)
    const mock = createGateway({
      contextWindow: 32_000,
      scan: () => {
        throw new Error('Refine must not rescan material')
      },
    })
    const job = createWritingSkillJob({
      libraryId: library.id,
      instruction: '五官',
      modelConfigId: 'knowledgeExtraction',
      randomSeed: 321,
      request: {
        mode: 'refine',
        replaceCardId: existing.id,
        refineInstruction: '更强调眼神和情绪变化',
      },
    }, db)

    const completed = await new WritingSkillDistillationAgent({
      db,
      gateway: mock.gateway,
      loadLibrary: () => library,
    }).run(job.id)
    expect(completed?.status).toBe('COMPLETED')
    expect(completed?.roundCount).toBe(0)
    expect(completed?.resultCardId).toBe(existing.id)
    expect(mock.scanCalls).toHaveLength(0)
    expect(mock.getDistillCalls()).toBe(1)
  })

  it('repairs a source-leaking distillation once before saving', async () => {
    const { db } = createTestDb('retale-writing-skill-leak-repair')
    const library = createLibrary({
      chapterCount: 8,
      estimatedTokens: 20,
      textPrefix: '匿名化叙事材料用于验证原文泄漏修复机制',
    })
    let distillCalls = 0
    const gateway: ModelGateway = {
      getCapabilities: async () => ({
        contextWindow: 32_000,
        maxOutputTokens: 1024,
        supportsStructuredOutput: true,
        supportsToolCalling: false,
      }),
      generateStructured: async <T,>(options: {
        modelConfigId: string
        messages: WritingSkillChatMessage[]
        schemaName: string
        schema: Record<string, unknown>
        runtimeSchema: z.ZodType<T>
        maxOutputTokens: number
        temperature?: number
        signal?: AbortSignal
      }): Promise<StructuredGenerationResult<T>> => {
        const userContent = options.messages.find((message) => message.role === 'user')?.content ?? ''
        if (options.schemaName === 'writing_skill_material_scan') {
          const refs = refsFromNumberedMaterial(userContent)
          return {
            data: {
              normalizedTopic: '人物五官与面部神态',
              coverage: 'sufficient',
              candidates: refs.map((ref, index) => ({
                startRef: ref,
                endRef: ref,
                aspect: `角度-${index + 1}`,
                relevance: 0.9,
              })),
            } as T,
            usage: { inputTokens: 10, outputTokens: 10 },
          }
        }
        distillCalls += 1
        const refs = refsFromEvidence(userContent)
        const result = createDistillationResult(refs)
        if (distillCalls === 1) result.title = library.paragraphs[0].anonymizedText
        return { data: result as T, usage: { inputTokens: 10, outputTokens: 10 } }
      },
    }

    const job = await runAgent({ db, library, gateway })
    expect(job.status).toBe('COMPLETED')
    expect(distillCalls).toBe(2)
    expect(readWritingSkillCardDetail(job.resultCardId!, db)?.title).toBe('作者甲 · 五官描写')
  })
})

describe('writing skill store persistence', () => {
  it('permanently deletes a card and cascades its saved examples', async () => {
    const { db, database } = createTestDb('retale-writing-skill-delete')
    const result = createDistillationResult(Array.from({ length: 8 }, (_, index) => formatMaterialParagraphRef(index + 1, 1)))
    const card = await saveWritingSkillCard({
      libraryId: 'library-1',
      libraryVersion: 'version-1',
      libraryName: '作者甲素材库',
      userInstruction: '五官',
      modelConfigId: 'knowledgeExtraction',
      sourceJobId: 'job-1',
      result,
      examples: result.exampleCandidates.map((example, index) => ({
        rangeRef: {
          libraryId: 'library-1',
          libraryVersion: 'version-1',
          workId: 'work-1',
          chapterId: `chapter-${index + 1}`,
          startParagraphId: `paragraph-${index + 1}`,
          endParagraphId: `paragraph-${index + 1}`,
        },
        displayRef: example.ref,
        score: example.score,
      })),
    }, db)

    expect(deleteWritingSkillCard(card.id, db)).toBe(true)
    expect(readWritingSkillCardDetail(card.id, db)).toBeNull()
    expect(database.prepare('SELECT COUNT(*) AS count FROM WritingSkillExample WHERE skillCardId = ?').get(card.id))
      .toEqual({ count: 0 })
    expect(deleteWritingSkillCard(card.id, db)).toBe(false)
  })

  it('round-trips only paragraph range references and never persists source prose', async () => {
    const { db, database } = createTestDb('retale-writing-skill-store')
    const proseSentinel = 'THIS-SOURCE-PROSE-MUST-NEVER-BE-PERSISTED'
    const result = createDistillationResult(Array.from({ length: 8 }, (_, index) => formatMaterialParagraphRef(index + 1, 1)))
    const card = await saveWritingSkillCard({
      libraryId: 'library-1',
      libraryVersion: 'version-1',
      libraryName: '作者甲素材库',
      userInstruction: '五官',
      modelConfigId: 'knowledgeExtraction',
      sourceJobId: 'job-1',
      result,
      examples: result.exampleCandidates.map((example, index) => ({
        rangeRef: {
          libraryId: 'library-1',
          libraryVersion: 'version-1',
          workId: 'work-1',
          chapterId: `chapter-${index + 1}`,
          startParagraphId: `paragraph-${index + 1}`,
          endParagraphId: `paragraph-${index + 1}`,
        },
        displayRef: example.ref,
        score: example.score,
      })),
    }, db)

    expect(card.examples[0].rangeRef.startParagraphId).toBe('paragraph-1')
    const persisted = database.prepare(`
      SELECT card.rulesJson, card.avoidJson, example.rangeRefJson
      FROM WritingSkillCard card
      JOIN WritingSkillExample example ON example.skillCardId = card.id
      WHERE card.id = ?
    `).all(card.id)
    expect(JSON.stringify(persisted)).not.toContain(proseSentinel)
    expect(JSON.stringify(persisted)).not.toContain('anonymizedText')
  })

  it('filters disabled references and marks a card stale when the library version changes', async () => {
    const { db } = createTestDb('retale-writing-skill-stale')
    const library = createLibrary({ chapterCount: 8, estimatedTokens: 20 })
    const result = createDistillationResult(library.paragraphs.map((paragraph) => paragraph.displayRef))
    const card = await saveWritingSkillCard({
      libraryId: library.id,
      libraryVersion: library.version,
      libraryName: library.name,
      userInstruction: '五官',
      modelConfigId: 'knowledgeExtraction',
      sourceJobId: 'job-1',
      result,
      examples: result.exampleCandidates.map((example, index) => ({
        rangeRef: {
          libraryId: library.id,
          libraryVersion: library.version,
          workId: library.workId,
          chapterId: `chapter-${index + 1}`,
          startParagraphId: `paragraph-${index + 1}`,
          endParagraphId: `paragraph-${index + 1}`,
        },
        displayRef: example.ref,
        score: example.score,
      })),
    }, db)
    await updateWritingSkillCard(card.id, {
      examples: [{ id: card.examples[0].id, enabled: false }],
    }, db)

    const selected = selectSkillExamples({ cardId: card.id, count: 6, seed: 1, db, library })
    expect(selected).toHaveLength(5)
    expect(selected.some((example) => example.id === card.examples[0].id)).toBe(false)

    const staleLibrary = createLibrary({ chapterCount: 8, estimatedTokens: 20, version: 'library-version-2' })
    expect(() => selectSkillExamples({ cardId: card.id, count: 3, seed: 1, db, library: staleLibrary }))
      .toThrow('素材库版本已经过期')
    expect(readWritingSkillCardDetail(card.id, db)?.status).toBe('STALE')
  })
})
