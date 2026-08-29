import { z } from 'zod'
import { WRITING_SKILL_DEFAULTS } from '@/lib/writing-skill-defaults'

export const materialScanResultSchema = z.object({
  normalizedTopic: z.string().trim().min(1).max(120),
  coverage: z.enum(['sufficient', 'insufficient']),
  candidates: z.array(z.object({
    startRef: z.string().trim().min(1).max(40),
    endRef: z.string().trim().min(1).max(40),
    aspect: z.string().trim().min(1).max(120),
    relevance: z.number().min(0).max(1),
  }).strict()).max(WRITING_SKILL_DEFAULTS.maxCandidatesPerRound),
}).strict()

export const skillDistillationResultSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(100).max(400),
  rules: z.array(z.object({
    text: z.string().trim().min(1).max(240),
    evidenceRefs: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  }).strict()).min(4).max(8),
  applicationScope: z.string().trim().min(20).max(400),
  avoid: z.array(z.string().trim().min(1).max(180)).min(2).max(5),
  exampleCandidates: z.array(z.object({
    ref: z.string().trim().min(1).max(80),
    score: z.number().min(0).max(1),
  }).strict()).min(WRITING_SKILL_DEFAULTS.minExamplePoolSize).max(WRITING_SKILL_DEFAULTS.maxExamplePoolSize),
  confidence: z.number().min(0).max(1),
}).strict()

export const MATERIAL_SCAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['normalizedTopic', 'coverage', 'candidates'],
  properties: {
    normalizedTopic: { type: 'string', minLength: 1, maxLength: 120 },
    coverage: { type: 'string', enum: ['sufficient', 'insufficient'] },
    candidates: {
      type: 'array',
      maxItems: WRITING_SKILL_DEFAULTS.maxCandidatesPerRound,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startRef', 'endRef', 'aspect', 'relevance'],
        properties: {
          startRef: { type: 'string' },
          endRef: { type: 'string' },
          aspect: { type: 'string' },
          relevance: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

function uniqueMaterialRefs(allowedRefs: string[]) {
  return Array.from(new Set(allowedRefs.map((ref) => ref.trim().toUpperCase()).filter(Boolean)))
}

export function buildMaterialScanJsonSchema(allowedRefs: string[]) {
  const refs = uniqueMaterialRefs(allowedRefs)
  if (refs.length > 128) return MATERIAL_SCAN_JSON_SCHEMA
  return {
    ...MATERIAL_SCAN_JSON_SCHEMA,
    properties: {
      ...MATERIAL_SCAN_JSON_SCHEMA.properties,
      candidates: {
        ...MATERIAL_SCAN_JSON_SCHEMA.properties.candidates,
        items: {
          ...MATERIAL_SCAN_JSON_SCHEMA.properties.candidates.items,
          properties: {
            ...MATERIAL_SCAN_JSON_SCHEMA.properties.candidates.items.properties,
            startRef: { type: 'string', enum: refs },
            endRef: { type: 'string', enum: refs },
          },
        },
      },
    },
  }
}

export function buildMaterialScanRuntimeSchema(allowedRefs: string[]) {
  const refs = new Set(uniqueMaterialRefs(allowedRefs))
  return materialScanResultSchema.superRefine((result, context) => {
    if (result.coverage === 'sufficient' && result.candidates.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'coverage 为 sufficient 时必须返回至少一组候选段落',
      })
    }
    for (const [index, candidate] of result.candidates.entries()) {
      if (!refs.has(candidate.startRef.trim().toUpperCase())) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'startRef'],
          message: '必须逐字使用输入中存在的段落编号',
        })
      }
      if (!refs.has(candidate.endRef.trim().toUpperCase())) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'endRef'],
          message: '必须逐字使用输入中存在的段落编号',
        })
      }
    }
  })
}

export const SKILL_DISTILLATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'summary',
    'rules',
    'applicationScope',
    'avoid',
    'exampleCandidates',
    'confidence',
  ],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 100, maxLength: 400 },
    rules: {
      type: 'array',
      minItems: 4,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'evidenceRefs'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 240 },
          evidenceRefs: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: { type: 'string' },
          },
        },
      },
    },
    applicationScope: { type: 'string', minLength: 20, maxLength: 400 },
    avoid: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: { type: 'string', minLength: 1, maxLength: 180 },
    },
    exampleCandidates: {
      type: 'array',
      minItems: WRITING_SKILL_DEFAULTS.minExamplePoolSize,
      maxItems: WRITING_SKILL_DEFAULTS.maxExamplePoolSize,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'score'],
        properties: {
          ref: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const

function uniqueAllowedEvidenceRefs(allowedEvidenceRefs: string[]) {
  return Array.from(new Set(allowedEvidenceRefs.map((ref) => ref.trim()).filter(Boolean)))
}

export function buildSkillDistillationJsonSchema(allowedEvidenceRefs: string[]) {
  const allowedRefs = uniqueAllowedEvidenceRefs(allowedEvidenceRefs)
  return {
    ...SKILL_DISTILLATION_JSON_SCHEMA,
    properties: {
      ...SKILL_DISTILLATION_JSON_SCHEMA.properties,
      rules: {
        ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules,
        items: {
          ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules.items,
          properties: {
            ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules.items.properties,
            evidenceRefs: {
              ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules.items.properties.evidenceRefs,
              items: { type: 'string', enum: allowedRefs },
            },
          },
        },
      },
      exampleCandidates: {
        ...SKILL_DISTILLATION_JSON_SCHEMA.properties.exampleCandidates,
        items: {
          ...SKILL_DISTILLATION_JSON_SCHEMA.properties.exampleCandidates.items,
          properties: {
            ...SKILL_DISTILLATION_JSON_SCHEMA.properties.exampleCandidates.items.properties,
            ref: { type: 'string', enum: allowedRefs },
          },
        },
      },
    },
  }
}

export function buildSkillDistillationRuntimeSchema(allowedEvidenceRefs: string[]) {
  const allowedRefs = new Set(uniqueAllowedEvidenceRefs(allowedEvidenceRefs))
  return skillDistillationResultSchema.superRefine((result, context) => {
    for (const [ruleIndex, rule] of result.rules.entries()) {
      for (const [refIndex, ref] of rule.evidenceRefs.entries()) {
        if (!allowedRefs.has(ref)) {
          context.addIssue({
            code: 'custom',
            path: ['rules', ruleIndex, 'evidenceRefs', refIndex],
            message: `必须使用允许的核心证据范围编号：${Array.from(allowedRefs).join(', ')}`,
          })
        }
      }
    }
    for (const [exampleIndex, example] of result.exampleCandidates.entries()) {
      if (!allowedRefs.has(example.ref)) {
        context.addIssue({
          code: 'custom',
          path: ['exampleCandidates', exampleIndex, 'ref'],
          message: `必须使用允许的核心证据范围编号：${Array.from(allowedRefs).join(', ')}`,
        })
      }
    }
  })
}

export function buildMaterialScanPrompt(input: {
  userInstruction: string
  numberedMaterial: string
}) {
  return {
    system: [
      '你是一个小说写作素材分析器。',
      '用户会给出一个希望提炼的写作方向，以及一批带有稳定段落编号的匿名化小说文本。',
      '你的任务是找出真正体现该写作方向的代表性段落。',
      '要求：',
      '1. 根据语义理解用户方向，不要只进行字面关键词匹配。',
      '2. 可以识别用户未明确列出的相关表现形式。',
      '3. 只返回段落编号和简短的分析标签。',
      '4. 不得引用、复述或改写任何素材原文。',
      '5. 不得返回输入中不存在的段落编号。',
      '6. 如果素材中缺少足够证据，应明确返回 insufficient。',
      '7. 不要补充通用写作知识。',
      '8. 优先选择具有完整写作结构的连续段落，而不是单独一句漂亮句子。',
      `9. 最多返回 ${WRITING_SKILL_DEFAULTS.maxCandidatesPerRound} 组候选范围。`,
      '只输出符合指定 JSON Schema 的 JSON 对象。',
    ].join('\n'),
    user: [
      '用户希望提炼的写作方向：',
      input.userInstruction,
      '',
      '以下是匿名化素材：',
      input.numberedMaterial,
    ].join('\n'),
  }
}

export function buildSkillDistillationPrompt(input: {
  libraryName: string
  userInstruction: string
  evidenceMaterial: string
  refineInstruction?: string | null
  validationIssues?: string[]
}) {
  const repairBlock = input.validationIssues?.length
    ? [
        '',
        '上一次结果未通过后端验证，请只修复以下问题，不能引入新证据：',
        ...input.validationIssues.map((issue, index) => `${index + 1}. ${issue}`),
      ]
    : []
  return {
    system: [
      '你是一个小说写作技巧蒸馏器。',
      '用户指定了一个写作方向。你将收到一组已经筛选过的匿名化小说段落，每组都有稳定的段落编号。',
      '请从这些素材中总结该素材库实际使用的写作方法。',
      '要求：',
      '1. 所有结论必须来自给定素材。',
      '2. 不要补充与素材无关的通用写作建议。',
      '3. 每条主要技巧必须引用至少一个证据段落编号。',
      '4. 优先总结在多个独立片段中重复出现的方法。',
      '5. 可以总结结构、细节选择、叙事顺序、修辞方式、动作与情绪之间的关系。',
      '6. 不得引用、复述或改写素材原文。',
      '7. Few-shot 候选只返回段落编号。',
      '8. evidenceRefs 和 exampleCandidates.ref 只能逐字复制 EVIDENCE 标题中的核心候选范围编号；不得引用 CONTEXT 段落，也不得自行缩写或拆分范围。',
      '9. 避免将作品中的人物、设定或剧情当成写作技巧。',
      '10. 输出应当可以直接插入另一本小说的魔改 Prompt。',
      `11. summary 为 100–400 字，rules 为 4–8 条，avoid 为 2–5 条，exampleCandidates 为 ${WRITING_SKILL_DEFAULTS.minExamplePoolSize}–${WRITING_SKILL_DEFAULTS.maxExamplePoolSize} 组。`,
      '只输出符合指定 JSON Schema 的 JSON 对象。',
      ...repairBlock,
    ].join('\n'),
    user: [
      '素材库名称：',
      input.libraryName,
      '',
      '用户希望提炼的方向：',
      input.userInstruction,
      ...(input.refineInstruction?.trim()
        ? ['', '用户希望这样调整现有技巧：', input.refineInstruction.trim(), '请仍然只使用下面已有证据。']
        : []),
      '',
      '候选素材：',
      input.evidenceMaterial,
    ].join('\n'),
  }
}

export function buildPlainJsonStructuredOutputInstruction(schema: Record<string, unknown>) {
  return [
    '当前模型不保证原生结构化输出。',
    '请只返回一个合法 JSON 对象，不要使用 Markdown 代码块，不要输出解释。',
    'JSON 必须满足以下 Schema：',
    JSON.stringify(schema),
  ].join('\n')
}
