export type TimelineSelection =
  | {
      kind: 'chapter'
      chapterId: string
      chapterNo: number
    }
  | {
      kind: 'what_if'
      nodeId: string
      sessionId: string
      anchorChapterNo: number
    }
  | {
      kind: 'future_jump'
      nodeId: string
      runId: string
      sourceChapterNo: number
      targetChapterNo: number
    }

export type StoryTimelineNodeType = 'what_if' | 'future_jump'

export type ChapterTimelineItem = {
  type: 'chapter'
  chapterNo: number
  chapterId: string
  title: string
  wordCount: number
}

export type StoryTimelineNodeRecord = {
  id: string
  novelId: string
  branchId: string
  nodeType: StoryTimelineNodeType
  labelIndex: number
  anchorChapterNo: number
  title: string
  subtitle: string | null
  parentNodeId: string | null
  sourceChapterNo: number | null
  targetChapterNo: number | null
  chapterId: string | null
  whatIfSessionId: string | null
  futureJumpRunId: string | null
  laneIndex: number
  colorToken: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type StoryTimelineBranchNode = {
  type: 'branch_node'
  id: string
  nodeType: StoryTimelineNodeType
  anchorChapterNo: number
  parentNodeId: string | null
  title: string
  subtitle: string | null
  laneIndex: number
  colorToken: string | null
  sourceChapterNo: number | null
  targetChapterNo: number | null
  whatIfSessionId: string | null
  futureJumpRunId: string | null
  status: string
}

export type StoryTimelineEdge = {
  fromNodeId: string
  toNodeId: string
}

export type StoryTimelineResponse = {
  novelId: string
  branchId: string
  chapters: ChapterTimelineItem[]
  branchNodes: StoryTimelineBranchNode[]
  edges: StoryTimelineEdge[]
}

export type OutlineNodeChapterRecord = {
  id: string
  outlineNodeId: string
  chapterNo: number
  chapterId: string | null
  chapterTitle: string | null
  isPrimary: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type OutlineNodeRecord = {
  id: string
  novelId: string
  branchId: string
  chapterNo: number | null
  title: string
  summary: string
  originalOutcome: string | null
  trackKey: string
  phaseLabel: string | null
  sourceType: string
  confidence: number | null
  involvedEntities: string[]
  keyEvents: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type FutureMapTrack = {
  trackKey: string
  phaseLabel: string | null
  eventCount: number
  sourceTypes: string[]
}

export type FutureMapEvent = {
  id: string
  chapterNo: number | null
  title: string
  summary: string
  originalOutcome: string | null
  trackKey: string
  phaseLabel: string | null
  sourceType: string
  confidence: number | null
  sortOrder: number
}

export type FutureMapDefaults = {
  selectedTrackKey: string | null
  selectedOutlineNodeId: string | null
}

export type FutureMapResponse = {
  novelId: string
  branchId: string
  tracks: FutureMapTrack[]
  events: FutureMapEvent[]
  chaptersByEvent: Record<string, OutlineNodeChapterRecord[]>
  defaults: FutureMapDefaults
}

export type WhatIfSessionRecord = {
  id: string
  novelId: string
  baseBranchId: string
  sourceChapterNo: number
  title: string
  premise: string
  selectedText: string
  originalText: string
  generatedText: string
  status: string
  createdAt: string
  updatedAt: string
}

export type WhatIfDeltaRecord = {
  id: string
  sessionId: string
  deltaType: string
  subjectName: string | null
  targetName: string | null
  subjectEntityId: string | null
  targetEntityId: string | null
  key: string
  oldValue: string | null
  newValue: string | null
  validFromChapter: number | null
  description: string
  confidence: number | null
  createdAt: string
}

export type WhatIfSessionDetail = WhatIfSessionRecord & {
  deltas: WhatIfDeltaRecord[]
}

export type WhatIfCreateRequest = {
  novelId: string
  branchId: string
  sourceChapterNo: number
  selectedText: string
  originalText: string
  generatedText: string
  userInstruction: string
  titleHint?: string | null
  subtitleHint?: string | null
}

export type WhatIfCreateResponse = {
  sessionId: string
  timelineNodeId: string
  generatedText: string
  deltas: WhatIfDeltaRecord[]
  title: string
  subtitle: string | null
}

export type FutureJumpRevisionRecord = {
  id: string
  runId: string
  revisionNo: number
  revisionKind: string
  userFeedback: string | null
  bridgeSummary: string
  generatedTargetText: string
  createdAt: string
}

export type FutureJumpRevisionHistoryItem = {
  revisionNo: number
  revisionKind: string
  userFeedback: string | null
  createdAt: string
}

export type FutureJumpRunRecord = {
  id: string
  sessionId: string
  baseBranchId: string
  parentTimelineNodeId: string | null
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  sourceChapterNo: number
  targetChapterNo: number
  userDirection: string
  bridgeSummary: string
  generatedTargetText: string
  latestRevisionNo: number
  errorMessage: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type FutureJumpCreateRequest = {
  sessionId: string
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  parentTimelineNodeId?: string | null
  userDirection?: string | null
}

export type FutureJumpMutationResponse = {
  runId: string
  timelineNodeId: string | null
  bridgeSummary: string
  generatedTargetText: string
  presetCompat?: PresetCompatResponseMetadata | null
}

export type FutureJumpReviseRequest = {
  userFeedback: string
}

export type FutureJumpRunDetail = FutureJumpRunRecord & {
  timelineNodeId: string | null
  latestRevision: FutureJumpRevisionRecord | null
  revisionHistory: FutureJumpRevisionHistoryItem[]
  revisions: FutureJumpRevisionRecord[]
}
import type { PresetCompatResponseMetadata } from '@/lib/preset-compat/runtime-integration'
