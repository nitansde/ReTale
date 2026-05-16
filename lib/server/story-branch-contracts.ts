import { z } from 'zod'

const positiveInt = z.number().int().positive()
const optionalNullableString = z.string().nullable().optional()

export const timelineSelectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chapter'),
    chapterId: z.string().min(1),
    chapterNo: positiveInt,
  }),
  z.object({
    kind: z.literal('what_if'),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    anchorChapterNo: positiveInt,
  }),
  z.object({
    kind: z.literal('future_jump'),
    nodeId: z.string().min(1),
    runId: z.string().min(1),
    sourceChapterNo: positiveInt,
    targetChapterNo: positiveInt,
  }),
])

export const whatIfDeltaSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  deltaType: z.string().min(1),
  subjectName: z.string().nullable(),
  targetName: z.string().nullable(),
  subjectEntityId: z.string().nullable(),
  targetEntityId: z.string().nullable(),
  key: z.string().min(1),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  validFromChapter: positiveInt.nullable(),
  description: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().min(1),
})

export const whatIfSessionCreateSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  baseBranchId: z.string().min(1),
  sourceChapterNo: positiveInt,
  title: z.string().min(1),
  premise: z.string().min(1),
  selectedText: z.string(),
  originalText: z.string(),
  generatedText: z.string(),
  status: z.string().min(1).default('active'),
})

export const whatIfDeltaCreateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  deltaType: z.string().min(1),
  subjectName: optionalNullableString,
  targetName: optionalNullableString,
  subjectEntityId: optionalNullableString,
  targetEntityId: optionalNullableString,
  key: z.string().min(1),
  oldValue: optionalNullableString,
  newValue: optionalNullableString,
  validFromChapter: positiveInt.nullable().optional(),
  description: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
})

export const whatIfSessionDetailSchema = whatIfSessionCreateSchema.extend({
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  deltas: z.array(whatIfDeltaSchema),
})

export const whatIfCreateRequestSchema = z.object({
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  sourceChapterNo: positiveInt,
  selectedText: z.string(),
  originalText: z.string(),
  generatedText: z.string().min(1),
  userInstruction: z.string().min(1),
  titleHint: z.string().nullable().optional(),
  subtitleHint: z.string().nullable().optional(),
})

export const whatIfDeltaExtractionSchema = z.object({
  deltas: z.array(z.object({
    delta_type: z.string().min(1),
    subject_name: optionalNullableString,
    target_name: optionalNullableString,
    key: z.string().min(1),
    old_value: optionalNullableString,
    new_value: optionalNullableString,
    valid_from_chapter: positiveInt.nullable().optional(),
    description: z.string().min(1),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })),
})

export const whatIfCreateResponseSchema = z.object({
  sessionId: z.string().min(1),
  timelineNodeId: z.string().min(1),
  generatedText: z.string().min(1),
  deltas: z.array(whatIfDeltaSchema).min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
})

export const storyTimelineNodeCreateSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  nodeType: z.enum(['what_if', 'future_jump']),
  labelIndex: z.number().int().nonnegative(),
  anchorChapterNo: positiveInt,
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  parentNodeId: z.string().nullable(),
  sourceChapterNo: positiveInt.nullable(),
  targetChapterNo: positiveInt.nullable(),
  chapterId: z.string().nullable(),
  whatIfSessionId: z.string().nullable(),
  futureJumpRunId: z.string().nullable(),
  laneIndex: z.number().int().nonnegative().default(0),
  colorToken: z.string().nullable(),
  status: z.string().min(1),
})

export const outlineNodeChapterCreateSchema = z.object({
  id: z.string().min(1),
  outlineNodeId: z.string().min(1),
  chapterNo: positiveInt,
  chapterId: z.string().nullable(),
  chapterTitle: z.string().nullable(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
})

export const outlineNodeCreateSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  chapterNo: positiveInt.nullable(),
  title: z.string().min(1),
  summary: z.string().min(1),
  originalOutcome: z.string().nullable(),
  trackKey: z.string().min(1),
  phaseLabel: z.string().nullable(),
  sourceType: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  involvedEntities: z.array(z.string()),
  keyEvents: z.array(z.string()),
  sortOrder: z.number().int().nonnegative(),
})

export const futureJumpRevisionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  revisionNo: positiveInt,
  revisionKind: z.string().min(1),
  userFeedback: z.string().nullable(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
  createdAt: z.string().min(1),
})

export const futureJumpRunCreateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  baseBranchId: z.string().min(1),
  parentTimelineNodeId: z.string().nullable(),
  targetOutlineNodeId: z.string().min(1),
  targetOutlineChapterId: z.string().min(1),
  sourceChapterNo: positiveInt,
  targetChapterNo: positiveInt,
  userDirection: z.string(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
  latestRevisionNo: positiveInt.default(1),
  errorMessage: z.string().nullable().default(null),
  status: z.string().min(1),
})

export const futureJumpRunDetailSchema = futureJumpRunCreateSchema.extend({
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  timelineNodeId: z.string().nullable(),
  latestRevision: z.lazy(() => futureJumpRevisionSchema).nullable(),
  revisionHistory: z.array(z.object({
    revisionNo: positiveInt,
    revisionKind: z.string().min(1),
    userFeedback: z.string().nullable(),
    createdAt: z.string().min(1),
  })),
  revisions: z.array(z.lazy(() => futureJumpRevisionSchema)),
})

export const futureJumpCreateRequestSchema = z.object({
  sessionId: z.string().min(1),
  targetOutlineNodeId: z.string().min(1),
  targetOutlineChapterId: z.string().min(1),
  parentTimelineNodeId: z.string().nullable().optional(),
  userDirection: z.string().nullable().optional(),
})

export const futureJumpMutationResponseSchema = z.object({
  runId: z.string().min(1),
  timelineNodeId: z.string().nullable(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
  presetCompat: z.object({
    warnings: z.array(z.string()),
    promptAssembly: z.unknown(),
    fieldStatuses: z.array(z.unknown()),
    providerControlIntents: z.array(z.unknown()),
    contextWindow: z.unknown().nullable(),
    streamPolicy: z.unknown().nullable(),
  }).nullable().optional(),
})

export const futureJumpReviseRequestSchema = z.object({
  userFeedback: z.string().min(1),
})

export const futureJumpReviseSchema = z.object({
  runId: z.string().min(1),
  revisionKind: z.enum(['initial', 'revise', 'retry']),
  userFeedback: z.string().nullable(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
})

export const bridgeSummaryGenerationSchema = z.object({
  bridgeSummary: z.string().min(1),
})

export const targetRewriteGenerationSchema = z.object({
  generatedTargetText: z.string().min(1),
  titleHint: z.string().min(1).optional(),
  subtitleHint: z.string().min(1).optional(),
})
