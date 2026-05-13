export type Novel = {
  id: string
  title: string
  summary: string
  tags: string[]
  updatedAt: string
  wordCount: number
  chapterCount: number
}

export type Volume = {
  id: string
  novelId: string
  title: string
  order: number
}

export type LocalNovelMeta = {
  id: string
  title: string
  summary: string
  tags: string[]
}

export type ChapterStatus = 'draft' | 'review' | 'done'
export type ChapterKind = 'main' | 'branch'

export type Chapter = {
  id: string
  novelId: string
  volumeId: string
  title: string
  order: number
  content: string
  originalContent?: string
  status: ChapterStatus
  wordCount: number
  updatedAt: string
  kind?: ChapterKind
  parentChapterId?: string
  branchLabel?: string
  trajectory?: string[]
}

export type OutlineType = 'main' | 'side' | 'foreshadow' | 'conflict' | 'climax'

export type OutlineItem = {
  id: string
  novelId: string
  title: string
  type: OutlineType
  summary: string
  relatedChapterIds: string[]
}

export type Character = {
  id: string
  novelId: string
  name: string
  role: string
  goal: string
  trait: string
  note: string
}

export type CharacterRelation = {
  id: string
  novelId: string
  fromCharacterId: string
  toCharacterId: string
  label: string
  strength: 'weak' | 'medium' | 'strong'
  status: 'active' | 'strained' | 'hidden' | 'resolved'
  note: string
  chapterIds: string[]
}

export type WorldEntryType = 'location' | 'scene' | 'organization' | 'rule' | 'item' | 'history'

export type WorldEntry = {
  id: string
  novelId: string
  title: string
  type: WorldEntryType
  content: string
}

export type TimelineEvent = {
  id: string
  novelId: string
  title: string
  phase: string
  worldline: string
  summary: string
  order: number
  chapterIds: string[]
}

export type HelperTab = 'ai' | 'references' | 'trajectory' | 'stats'
export type WorkspaceTab = 'editor' | 'rewrite' | 'outline' | 'characters' | 'world'

export type RewriteMode =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'perspective'
  | 'relationship'
  | 'branch'
  | 'continue'
  | 'dialogue'
  | 'compression'

export type RewriteTone =
  | 'keep'
  | 'dramatic'
  | 'dark'
  | 'romantic'
  | 'light-novel'
  | 'colder'
  | 'cinematic'

export type RewriteOutput = 'candidate' | 'replace' | 'branch' | 'insert'
export type RewriteScope = 'chapter' | 'paragraph' | 'selection'
export type ConstraintStrength = 'off' | 'soft' | 'strict'
export type ThoughtLevel = 'none' | 'medium' | 'long'

export type RewriteConstraint = {
  id: string
  label: string
  enabled: boolean
  strength: ConstraintStrength
}

export type RewritePreset = {
  id: string
  name: string
  mode: RewriteMode
  tone: RewriteTone
  prompt: string
}

export type RewriteCandidate = {
  id: string
  batchId: string
  title: string
  summary: string
  content: string
  mode: RewriteMode
  tone: RewriteTone
  selected: boolean
  createdAt: string
  prompt: string
  sourceExcerpt: string
  actions: Array<'apply' | 'insert' | 'branch' | 'continue'>
}

export type RewriteHistoryEntry = {
  id: string
  batchId: string
  chapterId: string
  scope: RewriteScope
  sourceExcerpt: string
  mode: RewriteMode
  tone: RewriteTone
  createdAt: string
  candidateIds: string[]
}

export type TrajectoryEntry = {
  id: string
  chapterId: string
  type: 'rewrite' | 'apply' | 'branch' | 'insert' | 'continue' | 'note'
  title: string
  detail: string
  createdAt: string
}

export type RewriteSelection = {
  scope: RewriteScope
  paragraphIndex: number | null
  text: string
}

export type AISettings = {
  rewriteProvider?: 'openai-compatible' | 'ollama'
  knowledgeProvider?: 'openai-compatible' | 'ollama'
  baseUrl: string
  apiKey: string
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
  model: string
  configured?: boolean
  ollamaBaseUrl?: string
  ollamaRewriteModel?: string
  ollamaModel?: string
  ollamaEmbeddingModel?: string
}

export type PersistedNovelState = {
  currentNovelId: string
  currentChapterId: string
  currentTab: WorkspaceTab
  helperTab: HelperTab
  expandedVolumeIds: string[]
  localNovels: LocalNovelMeta[]
  localVolumes: Volume[]
  localChapters: Chapter[]
  localOutlines: OutlineItem[]
  localCharacters: Character[]
  localCharacterRelations: CharacterRelation[]
  localWorldEntries: WorldEntry[]
  localTimelineEvents: TimelineEvent[]
  rewriteCandidates: RewriteCandidate[]
  rewriteHistory: RewriteHistoryEntry[]
  trajectories: TrajectoryEntry[]
  rewriteMode: RewriteMode
  rewriteTone: RewriteTone
  rewriteOutput: RewriteOutput
  rewriteScope: RewriteScope
  selectionText: string
  selectedParagraphIndex: number | null
  thinkingLevel: ThoughtLevel
  autoContinue: boolean
  keepCanon: boolean
  promptText: string
  selectedPresetId: string
  presets: RewritePreset[]
  constraints: RewriteConstraint[]
  focusMode: boolean
  aiSettings?: AISettings
}
