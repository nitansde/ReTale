export type EntityType =
  | 'character'
  | 'location'
  | 'faction'
  | 'item'
  | 'ability'
  | 'rule'
  | 'concept'
  | 'event'
  | 'thread'

export type LinkStatus =
  | 'ai_generated'
  | 'user_confirmed'
  | 'rejected'
  | 'outdated'
  | 'conflicted'
  | 'potentially_stale'

export type GraphAwareRequest = {
  novelId: string
  branchId: string
  chapterNo: number
  selectedText: string
  nearbyText: string
  operationType: 'expand' | 'rewrite' | 'polish' | 'dialogue' | 'deep_rewrite'
  maxHops?: 1 | 2
  includeLowConfidence?: boolean
  confirmedOnly?: boolean
}

export type GraphSubgraphRequest = {
  novelId: string
  branchId: string
  chapterNo: number
  entityIds: string[]
  maxHops?: 1 | 2
  includeLowConfidence?: boolean
  confirmedOnly?: boolean
}

export type GraphNode = {
  id: string
  entityType: EntityType
  label: string
  description?: string
  status?: string
  importance: number
  confidence: number
  userConfirmed: boolean
  firstSeenChapter?: number
  lastSeenChapter?: number
  score: number
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  linkType: string
  label?: string
  description?: string
  polarity?: 'positive' | 'negative' | 'neutral' | 'mixed'
  strength: number
  confidence: number
  validFromChapter: number
  validToChapter?: number
  evidenceQuote?: string
  evidenceLocation?: {
    chapterNo: number
    lineStart?: number
    lineEnd?: number
  }
  status: LinkStatus
  hop: 1 | 2
  score: number
  includeInPrompt: boolean
}

export type GraphAwareResult = {
  seedEntities: GraphNode[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  contextText: string
  warnings: string[]
  tokenEstimate: number
  status: 'ready'
}

export type EntityLinkRow = {
  id: string
  novelId: string
  branchId: string
  sourceEntityId: string
  targetEntityId: string
  linkType: string
  label: string | null
  description: string | null
  polarity: 'positive' | 'negative' | 'neutral' | 'mixed' | null
  strength: number
  weight: number
  sourceChapter: number
  validFromChapter: number
  validToChapter: number | null
  evidenceSpanId: string | null
  evidenceQuote: string | null
  confidence: number
  status: LinkStatus
  includeByDefault: number
}

export type EntityStateRow = {
  id: string
  novelId: string
  branchId: string
  entityId: string
  stateType: string
  stateValue: string
  description: string | null
  sourceChapter: number
  validFromChapter: number
  validToChapter: number | null
  evidenceSpanId: string | null
  evidenceQuote: string | null
  confidence: number
  status: LinkStatus
  includeByDefault: number
}

export type EventLinkRow = {
  id: string
  novelId: string
  branchId: string
  sourceEventId: string
  targetEventId: string
  linkType: string
  label: string | null
  description: string | null
  sourceChapter: number
  validFromChapter: number
  evidenceSpanId: string | null
  evidenceQuote: string | null
  confidence: number
  status: LinkStatus
}

export type GraphContextCacheRow = {
  id: string
  novelId: string
  branchId: string
  cacheKey: string
  asOfChapter: number
  seedEntityIdsJson: string
  graphNodesJson: string
  graphEdgesJson: string
  contextText: string
  sourceHash: string
  createdAt: string
  updatedAt: string
}
