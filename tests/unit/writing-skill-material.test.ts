import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  calculateWritingSkillScanChunkBudget,
  resolveWritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'
import { createDatabaseAccess } from '@/lib/server/database-access'
import { initializeDatabase } from '@/lib/server/sqlite'
import { CONTROL_SCHEMA_SQL } from '@/lib/server/schema'
import {
  compileEvidenceMaterial,
  compileNumberedMaterial,
  formatMaterialParagraphRef,
  loadMaterialLibrary,
  parseMaterialParagraphRef,
  parseMaterialRangeDisplayRef,
  resolveInternalMaterialRange,
  resolveMaterialRange,
  sampleWritingSkillMaterial,
  validateWritingSkillScanResult,
  type MaterialLibrary,
} from '@/lib/server/writing-skill-material'
import {
  createUploadedWritingSkillMaterial,
  deleteUploadedWritingSkillMaterial,
  listUploadedWritingSkillMaterials,
  loadWritingSkillMaterialCollection,
} from '@/lib/server/writing-skill-sources'
import {
  buildMaterialScanPrompt,
  buildPlainJsonStructuredOutputInstruction,
  buildSkillDistillationJsonSchema,
  buildSkillDistillationPrompt,
  buildSkillDistillationRuntimeSchema,
} from '@/lib/server/writing-skill-prompts'
import {
  listWritingSkillCards,
  saveWritingSkillCard,
} from '@/lib/server/writing-skill-store'
import {
  chooseWritingSkillExamples,
  compileWritingSkillPrompt,
} from '@/lib/server/writing-skill-runtime'
import type {
  MaterialParagraph,
  ResolvedSkillExample,
  WritingSkillCard,
  WritingSkillExample,
} from '@/lib/writing-skill-types'

function createLibrary(input: {
  chapterCount: number
  paragraphsPerChapter?: number
  estimatedTokens?: number
  version?: string
  id?: string
  name?: string
}) {
  const libraryId = input.id ?? 'library-1'
  const paragraphs: MaterialParagraph[] = []
  const paragraphsPerChapter = input.paragraphsPerChapter ?? 1
  for (let chapterIndex = 1; chapterIndex <= input.chapterCount; chapterIndex += 1) {
    for (let paragraphIndex = 1; paragraphIndex <= paragraphsPerChapter; paragraphIndex += 1) {
      const displayRef = formatMaterialParagraphRef(chapterIndex, paragraphIndex)
      paragraphs.push({
        id: `paragraph-${chapterIndex}-${paragraphIndex}`,
        libraryId,
        libraryVersion: input.version ?? 'version-1',
        workId: `${libraryId}:work`,
        chapterId: `${libraryId}:chapter-${chapterIndex}`,
        chapterIndex,
        paragraphIndex,
        anonymizedText: `匿名化素材 ${displayRef}`,
        estimatedTokens: input.estimatedTokens ?? 10,
        displayRef,
      })
    }
  }
  return {
    id: libraryId,
    version: input.version ?? 'version-1',
    name: input.name ?? '测试素材库',
    author: '作者甲',
    workId: `${libraryId}:work`,
    paragraphs,
    totalTokens: paragraphs.reduce((sum, paragraph) => sum + paragraph.estimatedTokens, 0),
    chapterIds: Array.from({ length: input.chapterCount }, (_, index) => `${libraryId}:chapter-${index + 1}`),
    paragraphByDisplayRef: new Map(paragraphs.map((paragraph) => [paragraph.displayRef, paragraph])),
    paragraphById: new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph])),
  } satisfies MaterialLibrary
}

function createExample(input: {
  id: string
  chapterId: string
  score?: number
}): WritingSkillExample {
  return {
    id: input.id,
    skillCardId: 'card-1',
    rangeRef: {
      libraryId: 'library-1',
      libraryVersion: 'version-1',
      workId: 'work-1',
      chapterId: input.chapterId,
      startParagraphId: `${input.id}-start`,
      endParagraphId: `${input.id}-end`,
    },
    displayRef: input.id,
    score: input.score ?? 0.9,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('writing skill material references and budgets', () => {
  it('builds the extraction library only from original chapter snapshots', () => {
    const database = initializeDatabase(new DatabaseSync(':memory:'))
    try {
      const db = createDatabaseAccess(database)
      const novelId = 'novel-original-only'
      const branchId = `${novelId}:main`
      db.execute(
        'INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)',
        novelId,
        '原文测试素材库',
        '作者甲',
        'workspace',
      )
      db.execute(
        'INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)',
        branchId,
        novelId,
        'main',
      )
      db.execute(
        `INSERT INTO KnowledgeChapter (
           id, novelId, branchId, chapterNo, title, rawText, revision, sourceHash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'chapter-1',
        novelId,
        branchId,
        1,
        '第一章',
        'AI 魔改正文，不得进入技巧提炼。',
        7,
        'ai-rewrite-hash',
      )
      db.execute(
        `INSERT INTO TextSpan (
           id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd, text, spanType
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'ai-generated-span',
        novelId,
        branchId,
        'chapter-1',
        1,
        1,
        1,
        'AI 续写、未来推演和魔改内容。',
        'paragraph',
      )
      db.execute("INSERT INTO WorkspaceRuntimeState (id) VALUES ('singleton')")
      db.execute(
        `INSERT INTO WorkspaceRuntimeChapter (
           workspaceStateId, id, novelId, title, sortOrder, contentHtml,
           originalContentHtml, status, wordCount, updatedAtLabel
         ) VALUES ('singleton', ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        'chapter-1',
        novelId,
        '第一章',
        1,
        '<p>AI 魔改正文，不得进入技巧提炼。</p><p>AI 插入段落。</p>',
        '<p>原文第一段。</p><p>原文第二段。</p>',
        2,
        '刚刚',
      )

      const first = loadMaterialLibrary(novelId, db)
      expect(first.paragraphs.map((paragraph) => paragraph.anonymizedText)).toEqual([
        '原文第一段。',
        '原文第二段。',
      ])
      expect(first.paragraphs.map((paragraph) => paragraph.id)).toEqual([
        'writing-skill-original:chapter-1:p1',
        'writing-skill-original:chapter-1:p2',
      ])
      expect(first.paragraphs.some((paragraph) => paragraph.anonymizedText.includes('AI'))).toBe(false)

      db.execute(
        `UPDATE WorkspaceRuntimeChapter SET contentHtml = ? WHERE workspaceStateId = 'singleton' AND id = ?`,
        '<p>另一版 AI 魔改正文。</p>',
        'chapter-1',
      )
      db.execute(
        'UPDATE KnowledgeChapter SET rawText = ?, revision = revision + 1, sourceHash = ? WHERE id = ?',
        '另一版 AI 魔改正文。',
        'another-ai-hash',
        'chapter-1',
      )
      const afterAiChange = loadMaterialLibrary(novelId, db)
      expect(afterAiChange.version).toBe(first.version)
      expect(afterAiChange.paragraphs.map((paragraph) => paragraph.anonymizedText)).toEqual([
        '原文第一段。',
        '原文第二段。',
      ])

      db.execute(
        `UPDATE WorkspaceRuntimeChapter SET originalContentHtml = ? WHERE workspaceStateId = 'singleton' AND id = ?`,
        '<p>原文修订后的第一段。</p>',
        'chapter-1',
      )
      const afterOriginalChange = loadMaterialLibrary(novelId, db)
      expect(afterOriginalChange.version).not.toBe(first.version)
      expect(afterOriginalChange.paragraphs.map((paragraph) => paragraph.anonymizedText)).toEqual([
        '原文修订后的第一段。',
      ])
    } finally {
      database.close()
    }
  })

  it('formats and parses stable paragraph and range references', () => {
    expect(formatMaterialParagraphRef(17, 6, 2)).toBe('W02-C017-P006')
    expect(parseMaterialParagraphRef('w02-c017-p006')).toEqual({
      workIndex: 2,
      chapterIndex: 17,
      paragraphIndex: 6,
    })
    expect(parseMaterialRangeDisplayRef('W02-C017-P006:P008')).toEqual({
      startRef: 'W02-C017-P006',
      endRef: 'W02-C017-P008',
    })
    expect(parseMaterialRangeDisplayRef('not-a-ref')).toBeNull()
    expect(parseMaterialRangeDisplayRef('W01-C001-P001:P002:P003')).toBeNull()
    expect(parseMaterialParagraphRef('W00-C001-P001')).toBeNull()
  })

  it('rejects cross-chapter, reversed, and stale internal ranges', () => {
    const library = createLibrary({ chapterCount: 2, paragraphsPerChapter: 3 })
    expect(resolveMaterialRange(library, 'W01-C001-P001:W01-C002-P001')).toBeNull()
    expect(resolveMaterialRange(library, 'W01-C001-P003:P001')).toBeNull()

    const current = resolveMaterialRange(library, 'W01-C001-P001:P002')!
    expect(resolveInternalMaterialRange(library, current.rangeRef)?.displayRef).toBe('W01-C001-P001:P002')
    expect(resolveInternalMaterialRange(library, {
      ...current.rangeRef,
      libraryVersion: 'version-2',
    })).toBeNull()
  })

  it('calculates safe per-call context chunks, resolves independent total budgets, and switches reading modes', () => {
    const capabilities = {
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
      supportsStructuredOutput: true,
      supportsToolCalling: false,
    }
    expect(calculateWritingSkillScanChunkBudget(capabilities)).toBe(168_000)
    expect(calculateWritingSkillScanChunkBudget(capabilities, '32k')).toBe(22_864)
    expect(calculateWritingSkillScanChunkBudget(capabilities, '1m')).toBe(168_000)
    expect(resolveWritingSkillTotalBudget('128k')).toBe(128_000)
    expect(resolveWritingSkillTotalBudget('2m')).toBe(2_000_000)
    expect(resolveWritingSkillTotalBudget('full')).toBeNull()

    const library = createLibrary({ chapterCount: 9, estimatedTokens: 100 })
    const full = sampleWritingSkillMaterial({ library, tokenBudget: 1_000, seed: 7 })
    expect(full.mode).toBe('full')
    expect(full.paragraphs).toHaveLength(9)

    const sampled = sampleWritingSkillMaterial({ library, tokenBudget: 330, seed: 7 })
    expect(sampled.mode).toBe('sampled')
    expect(sampled.estimatedTokens).toBeLessThanOrEqual(330)
    expect(new Set(sampled.chapterIds).size).toBe(sampled.chapterIds.length)
  })

  it('samples deterministically, honors exclusions, and compiles contiguous numbered material', () => {
    const library = createLibrary({ chapterCount: 12, paragraphsPerChapter: 2, estimatedTokens: 40 })
    const first = sampleWritingSkillMaterial({ library, tokenBudget: 300, seed: 12345 })
    const repeated = sampleWritingSkillMaterial({ library, tokenBudget: 300, seed: 12345 })
    const excluded = sampleWritingSkillMaterial({
      library,
      tokenBudget: 300,
      seed: 12346,
      excludedChapterIds: first.chapterIds,
    })

    expect(repeated.displayRefs).toEqual(first.displayRefs)
    expect(repeated.paragraphs.map((paragraph) => paragraph.id)).toEqual(first.paragraphs.map((paragraph) => paragraph.id))
    expect(excluded.chapterIds.some((chapterId) => first.chapterIds.includes(chapterId))).toBe(false)
    expect(compileNumberedMaterial(first.paragraphs)).toContain('=== WORK W01 / CHAPTER')
    expect(compileNumberedMaterial(first.paragraphs)).toContain(`[${first.paragraphs[0].displayRef}]`)
  })

  it('combines multiple selected books into stable W01/W02 material references', () => {
    const first = createLibrary({ chapterCount: 2, id: 'library-a', name: '作品甲' })
    const second = createLibrary({ chapterCount: 2, id: 'library-b', name: '作品乙' })
    const libraries = new Map([[first.id, first], [second.id, second]])
    const collection = loadWritingSkillMaterialCollection([
      { sourceType: 'LIBRARY', sourceId: first.id },
      { sourceType: 'LIBRARY', sourceId: second.id },
    ], {
      loadLibrary: (libraryId) => libraries.get(libraryId)!,
    })

    expect(collection.sources.map((source) => source.sourceName)).toEqual(['作品甲', '作品乙'])
    expect(collection.library.paragraphs.map((paragraph) => paragraph.displayRef)).toEqual([
      'W01-C001-P001',
      'W01-C002-P001',
      'W02-C001-P001',
      'W02-C002-P001',
    ])
    expect(compileNumberedMaterial(collection.library.paragraphs)).toContain('=== WORK W02 / CHAPTER C001 ===')
    expect(collection.library.chapterIds).toHaveLength(4)
  })

  it('stores uploaded distillation-only TXT material without creating a library novel', () => {
    const database = initializeDatabase(new DatabaseSync(':memory:'), {
      mode: 'control',
      schemaSql: CONTROL_SCHEMA_SQL,
    })
    try {
      const db = createDatabaseAccess(database)
      const material = createUploadedWritingSkillMaterial({
        title: '独立素材',
        rawText: '这是序言。\n\n第1章 起点\n\n第一段。\n\n第二段。',
        byteSize: 128,
      }, db)
      expect(listUploadedWritingSkillMaterials(db)).toMatchObject([{
        sourceType: 'UPLOAD',
        sourceId: material.sourceId,
        title: '独立素材',
        chapterCount: 2,
      }])
      const collection = loadWritingSkillMaterialCollection([
        { sourceType: 'UPLOAD', sourceId: material.sourceId },
      ], { db })
      expect(collection.library.paragraphs.length).toBeGreaterThanOrEqual(3)
      expect(database.prepare('SELECT COUNT(*) AS count FROM NovelRegistry').get()).toEqual({ count: 0 })
      expect(deleteUploadedWritingSkillMaterial(material.sourceId, db)).toBe(true)
      expect(listUploadedWritingSkillMaterials(db)).toHaveLength(0)
    } finally {
      database.close()
    }
  })

  it('lists a multi-source skill card from every library source compatibility endpoint', async () => {
    const database = initializeDatabase(new DatabaseSync(':memory:'), {
      mode: 'control',
      schemaSql: CONTROL_SCHEMA_SQL,
    })
    try {
      const db = createDatabaseAccess(database)
      const card = await saveWritingSkillCard({
        libraryId: 'writing-skill-collection:test',
        libraryVersion: 'collection-version',
        libraryName: '作品甲、作品乙',
        userInstruction: '环境描写',
        modelConfigId: 'knowledgeExtraction',
        sourceJobId: 'job-1',
        result: {
          title: '环境描写',
          summary: '从多部作品中总结环境描写方法。',
          rules: [{ text: '让环境变化承接人物感受。', evidenceRefs: ['W01-C001-P001'] }],
          applicationScope: '适用于场景进入与情绪转折。',
          avoid: ['避免堆砌无关景物'],
          exampleCandidates: [{ ref: 'W01-C001-P001', score: 0.9 }],
          confidence: 0.9,
        },
        sources: [
          {
            sourceType: 'LIBRARY',
            sourceId: 'library-a',
            sourceVersion: 'version-a',
            sourceName: '作品甲',
            sourceOrder: 0,
          },
          {
            sourceType: 'LIBRARY',
            sourceId: 'library-b',
            sourceVersion: 'version-b',
            sourceName: '作品乙',
            sourceOrder: 1,
          },
        ],
        examples: [],
      }, db)

      expect(listWritingSkillCards({ libraryId: 'library-a' }, db).map((item) => item.id)).toEqual([card.id])
      expect(listWritingSkillCards({ libraryId: 'library-b' }, db).map((item) => item.id)).toEqual([card.id])
      expect(listWritingSkillCards({ libraryId: 'library-c' }, db)).toHaveLength(0)
    } finally {
      database.close()
    }
  })

  it('drops invalid scan references and merges adjacent or overlapping candidates', () => {
    const library = createLibrary({ chapterCount: 2, paragraphsPerChapter: 5 })
    const sample = sampleWritingSkillMaterial({ library, tokenBudget: 10_000, seed: 1 })
    const candidates = validateWritingSkillScanResult({
      library,
      sample,
      result: {
        normalizedTopic: '面部神态',
        coverage: 'sufficient',
        candidates: [
          { startRef: 'W01-C001-P001', endRef: 'W01-C001-P002', aspect: '眉眼', relevance: 0.8 },
          { startRef: 'W01-C001-P002', endRef: 'W01-C001-P004', aspect: '视线', relevance: 0.9 },
          { startRef: 'W01-C001-P005', endRef: 'W01-C002-P001', aspect: '跨章', relevance: 0.9 },
          { startRef: 'W01-C002-P004', endRef: 'W01-C002-P002', aspect: '倒置', relevance: 0.9 },
          { startRef: 'W01-C099-P001', endRef: 'W01-C099-P001', aspect: '不存在', relevance: 0.9 },
          { startRef: 'W01-C002-P001', endRef: 'W01-C002-P001', aspect: '分数错误', relevance: 1.2 },
        ],
      },
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      displayRef: 'W01-C001-P001:P004',
      relevance: 0.9,
      aspect: '眉眼；视线',
    })
  })

  it('keeps adjacent context readable without exposing it as citable evidence', () => {
    const library = createLibrary({ chapterCount: 1, paragraphsPerChapter: 5 })
    library.paragraphs.forEach((paragraph, index) => {
      paragraph.anonymizedText = ['前置上下文', '核心一', '核心二', '核心三', '后置上下文'][index]
    })
    const resolved = resolveMaterialRange(library, 'W01-C001-P002:P004')!
    const material = compileEvidenceMaterial(library, [{
      rangeRef: resolved.rangeRef,
      displayRef: resolved.displayRef,
      chapterId: resolved.start.chapterId,
      chapterIndex: resolved.start.chapterIndex,
      startParagraphIndex: resolved.start.paragraphIndex,
      endParagraphIndex: resolved.end.paragraphIndex,
      aspect: '连续动作',
      relevance: 0.9,
    }])

    expect(material).toContain('- W01-C001-P002:P004')
    expect(material).toContain('前置上下文')
    expect(material).toContain('后置上下文')
    expect(material).toContain('[CONTEXT BEFORE — NOT CITABLE]')
    expect(material).toContain('[CONTEXT AFTER — NOT CITABLE]')
    expect(material).toContain('[CORE 1/3]')
    expect(material).not.toContain('[W01-C001-P001]')
    expect(material).not.toContain('[W01-C001-P005]')
  })
})

describe('writing skill runtime example selection', () => {
  it('is seeded, reproducible, diverse by chapter, and falls back to all available examples', () => {
    const examples = Array.from({ length: 8 }, (_, index) => createExample({
      id: `example-${index + 1}`,
      chapterId: `chapter-${(index % 5) + 1}`,
    }))
    const first = chooseWritingSkillExamples({ examples, count: 4, seed: 101 })
    const repeated = chooseWritingSkillExamples({ examples, count: 4, seed: 101 })
    const different = chooseWritingSkillExamples({ examples, count: 4, seed: 202 })

    expect(repeated.map((example) => example.id)).toEqual(first.map((example) => example.id))
    expect(different.map((example) => example.id)).not.toEqual(first.map((example) => example.id))
    expect(new Set(first.map((example) => example.rangeRef.chapterId)).size).toBe(4)
    expect(chooseWritingSkillExamples({ examples: examples.slice(0, 2), count: 5, seed: 1 })).toHaveLength(2)
  })
})

describe('writing skill prompts', () => {
  it('keeps scan, distillation, plain-JSON, and rewrite-skill prompt contracts stable', () => {
    const scan = buildMaterialScanPrompt({
      userInstruction: '五官',
      numberedMaterial: '[W01-C001-P001]\n[人物A]抬眼。',
    })
    expect(scan.system).toContain('只返回段落编号和简短的分析标签')
    expect(scan.system).toContain('不得引用、复述或改写任何素材原文')
    expect(scan.user).toMatchInlineSnapshot(`
      "用户希望提炼的写作方向：
      五官

      以下是匿名化素材：
      [W01-C001-P001]
      [人物A]抬眼。"
    `)

    const distill = buildSkillDistillationPrompt({
      libraryName: '作者甲素材库',
      userInstruction: '五官',
      evidenceMaterial: '=== EVIDENCE 1: W01-C001-P001 / 眼神 ===',
      refineInstruction: '更强调情绪变化',
      validationIssues: ['第 1 条规则缺少证据引用'],
    })
    expect(distill.system).toContain('不得引用、复述或改写素材原文')
    expect(distill.system).toContain('只能逐字复制 EVIDENCE 标题中的核心候选范围编号')
    expect(distill.system).toContain('只修复以下问题，不能引入新证据')
    expect(distill.user).toMatchInlineSnapshot(`
      "素材库名称：
      作者甲素材库

      用户希望提炼的方向：
      五官

      用户希望这样调整现有技巧：
      更强调情绪变化
      请仍然只使用下面已有证据。

      候选素材：
      === EVIDENCE 1: W01-C001-P001 / 眼神 ==="
    `)

    const allowedRefs = ['W01-C021-P007:P009', 'W01-C022-P074:P075']
    const dynamicSchema = buildSkillDistillationJsonSchema(allowedRefs)
    expect(dynamicSchema.properties.rules.items.properties.evidenceRefs.items.enum).toEqual(allowedRefs)
    expect(dynamicSchema.properties.exampleCandidates.items.properties.ref.enum).toEqual(allowedRefs)
    expect(dynamicSchema.properties.exampleCandidates.items.properties).not.toHaveProperty('tags')
    const runtimeSchema = buildSkillDistillationRuntimeSchema(allowedRefs)
    const invalidContextResult = {
      title: '测试技巧',
      summary: '这是一个用于验证动态引用约束的足够长总结。'.repeat(6),
      rules: Array.from({ length: 4 }, () => ({
        text: '围绕核心候选范围组织描写。',
        evidenceRefs: ['W01-C021-P006'],
      })),
      applicationScope: '适用于需要通过连续细节推进叙事并表现人物状态的场景。',
      avoid: ['避免静态罗列', '避免照抄素材'],
      exampleCandidates: Array.from({ length: 6 }, (_, index) => ({
        ref: allowedRefs[index % allowedRefs.length],
        score: 0.9,
      })),
      confidence: 0.9,
    }
    expect(runtimeSchema.safeParse(invalidContextResult).success).toBe(false)

    expect(buildPlainJsonStructuredOutputInstruction({
      type: 'object',
      required: ['coverage'],
    })).toMatchInlineSnapshot(`
      "当前模型不保证原生结构化输出。
      请只返回一个合法 JSON 对象，不要使用 Markdown 代码块，不要输出解释。
      JSON 必须满足以下 Schema：
      {\"type\":\"object\",\"required\":[\"coverage\"]}"
    `)

    const card: WritingSkillCard = {
      id: 'card-1',
      libraryId: 'library-1',
      libraryVersion: 'version-1',
      libraryName: '作者甲素材库',
      title: '作者甲 · 五官描写',
      userInstruction: '五官',
      summary: '选择少量具有辨识度的面部特征，并让视线、光线与当下情绪共同完成刻画。',
      applicationScope: '适用于人物出场、近距离观察和情绪转折。',
      rules: [
        { text: '先选择最能体现人物气质的一项特征。', evidenceRefs: ['W01-C001-P001'] },
        { text: '用细微动作承接未说出口的情绪。', evidenceRefs: ['W01-C002-P001'] },
      ],
      avoid: ['逐项罗列全部五官', '复制素材中的独特比喻'],
      defaultExampleCount: 2,
      modelConfigId: 'knowledgeExtraction',
      status: 'ACTIVE',
      sourceJobId: 'job-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const examples = [
      { ...createExample({ id: 'W01-C001-P001', chapterId: 'chapter-1' }), anonymizedText: '[人物A]在冷光里抬眼。' },
      { ...createExample({ id: 'W01-C002-P001', chapterId: 'chapter-2' }), anonymizedText: '[人物B]的嘴角短暂绷紧。' },
    ] satisfies ResolvedSkillExample[]
    expect(compileWritingSkillPrompt(card, examples)).toMatchInlineSnapshot(`
      "## 本次指定写作技巧：作者甲 · 五官描写

      ### 技巧概述
      选择少量具有辨识度的面部特征，并让视线、光线与当下情绪共同完成刻画。

      ### 写作方法
      1. 先选择最能体现人物气质的一项特征。
      2. 用细微动作承接未说出口的情绪。

      ### 适用范围
      适用于人物出场、近距离观察和情绪转折。

      ### 避免
      - 逐项罗列全部五官
      - 复制素材中的独特比喻

      ### 参考范文
      范文一：
      [人物A]在冷光里抬眼。

      范文二：
      [人物B]的嘴角短暂绷紧。

      只学习这些范文的描写方法、信息组织和细节选择。
      不得复制其中的具体措辞、人物、设定或情节。
      不得改变当前小说中已经确定的人物外貌、关系、世界观和事件结果。"
    `)
  })
})
