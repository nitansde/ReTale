export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS WorkspaceState (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AppSetting (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS NovelRecord (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  sourceType TEXT NOT NULL DEFAULT 'txt',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS StoryBranch (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  name TEXT NOT NULL,
  baseBranchId TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (baseBranchId) REFERENCES StoryBranch(id) ON DELETE SET NULL,
  UNIQUE (novelId, name)
);

CREATE TABLE IF NOT EXISTS KnowledgeChapter (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  title TEXT,
  rawText TEXT NOT NULL,
  summary TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  isDirty INTEGER NOT NULL DEFAULT 0,
  dirtyReason TEXT,
  sourceHash TEXT NOT NULL,
  knowledgeStatus TEXT NOT NULL DEFAULT 'ready',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  UNIQUE (novelId, branchId, chapterNo)
);

CREATE TABLE IF NOT EXISTS chapter_extraction_candidates (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  chapter_revision INTEGER,
  chapter_source_hash TEXT NOT NULL,
  extraction_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'extracted',
  provider TEXT,
  model TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(branch_id, chapter_id, chapter_source_hash)
);

CREATE TABLE IF NOT EXISTS ChapterLine (
  id TEXT PRIMARY KEY,
  chapterId TEXT NOT NULL,
  lineNo INTEGER NOT NULL,
  text TEXT NOT NULL,
  charStart INTEGER,
  charEnd INTEGER,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  UNIQUE (chapterId, lineNo)
);

CREATE TABLE IF NOT EXISTS TextSpan (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER NOT NULL,
  lineEnd INTEGER NOT NULL,
  charStart INTEGER,
  charEnd INTEGER,
  text TEXT NOT NULL,
  spanType TEXT NOT NULL,
  tokenEstimate INTEGER,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS KnowledgeEntity (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  entityType TEXT NOT NULL,
  canonicalName TEXT NOT NULL,
  description TEXT,
  firstSeenChapter INTEGER,
  lastSeenChapter INTEGER,
  status TEXT,
  importance INTEGER NOT NULL DEFAULT 3,
  userConfirmed INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  UNIQUE (branchId, canonicalName, entityType)
);

CREATE TABLE IF NOT EXISTS EntityAlias (
  id TEXT PRIMARY KEY,
  entityId TEXT NOT NULL,
  alias TEXT NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  sourceChapter INTEGER,
  confidence REAL NOT NULL DEFAULT 0.7,
  userConfirmed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL,
  UNIQUE (entityId, alias)
);

CREATE TABLE IF NOT EXISTS EntityMention (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  entityId TEXT,
  mentionText TEXT NOT NULL,
  resolutionKind TEXT NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EntityAppearance (
  id TEXT PRIMARY KEY,
  entityId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER,
  lineEnd INTEGER,
  evidenceSpanId TEXT,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EntityLink (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  sourceEntityId TEXT NOT NULL,
  targetEntityId TEXT NOT NULL,
  linkType TEXT NOT NULL,
  label TEXT,
  description TEXT,
  polarity TEXT,
  strength INTEGER NOT NULL DEFAULT 3,
  weight REAL NOT NULL DEFAULT 1,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  includeByDefault INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (targetEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EntityState (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  entityId TEXT NOT NULL,
  stateType TEXT NOT NULL,
  stateValue TEXT NOT NULL,
  description TEXT,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  includeByDefault INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeFact (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  factType TEXT NOT NULL,
  subjectEntityId TEXT,
  predicate TEXT NOT NULL,
  objectEntityId TEXT,
  valueJson TEXT,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (subjectEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (objectEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS FactEvidence (
  id TEXT PRIMARY KEY,
  factId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER,
  lineEnd INTEGER,
  quote TEXT NOT NULL,
  evidenceSpanId TEXT,
  FOREIGN KEY (factId) REFERENCES KnowledgeFact(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeRelation (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  sourceEntityId TEXT NOT NULL,
  targetEntityId TEXT NOT NULL,
  relationType TEXT NOT NULL,
  polarity TEXT,
  strength INTEGER NOT NULL DEFAULT 3,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (targetEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeEvent (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  eventType TEXT,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER,
  lineEnd INTEGER,
  importance INTEGER NOT NULL DEFAULT 3,
  consequences TEXT,
  evidenceSpanId TEXT,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EventParticipant (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL,
  entityId TEXT NOT NULL,
  role TEXT,
  FOREIGN KEY (eventId) REFERENCES KnowledgeEvent(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  UNIQUE (eventId, entityId, role)
);

CREATE TABLE IF NOT EXISTS EventLink (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  sourceEventId TEXT NOT NULL,
  targetEventId TEXT NOT NULL,
  linkType TEXT NOT NULL,
  label TEXT,
  description TEXT,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceEventId) REFERENCES KnowledgeEvent(id) ON DELETE CASCADE,
  FOREIGN KEY (targetEventId) REFERENCES KnowledgeEvent(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeWorld (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  term TEXT NOT NULL,
  category TEXT,
  definition TEXT NOT NULL,
  firstSeenChapter INTEGER,
  validFromChapter INTEGER,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  confidence REAL NOT NULL DEFAULT 0.7,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL,
  UNIQUE (branchId, term, category)
);

CREATE TABLE IF NOT EXISTS KnowledgeJob (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT,
  jobType TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  currentStep TEXT,
  payloadJson TEXT,
  errorMessage TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS RawTextEmbeddingCache (
  branchId TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  embeddingInputHash TEXT NOT NULL,
  vectorJson TEXT NOT NULL,
  vectorDimension INTEGER NOT NULL,
  lastSeenAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (branchId, provider, model, embeddingInputHash),
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS story_timeline_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  label_index INTEGER NOT NULL,
  anchor_chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  parent_node_id TEXT,
  source_chapter_no INTEGER,
  target_chapter_no INTEGER,
  chapter_id TEXT,
  what_if_session_id TEXT,
  future_jump_run_id TEXT,
  lane_index INTEGER DEFAULT 0,
  color_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (what_if_session_id) REFERENCES what_if_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (future_jump_run_id) REFERENCES future_jump_runs(id) ON DELETE SET NULL,
  UNIQUE (novel_id, branch_id, node_type, label_index),
  UNIQUE (what_if_session_id),
  UNIQUE (future_jump_run_id)
);

CREATE TABLE IF NOT EXISTS what_if_sessions (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  base_branch_id TEXT NOT NULL,
  source_chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  premise TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (base_branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS what_if_deltas (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  delta_type TEXT NOT NULL,
  subject_name TEXT,
  target_name TEXT,
  subject_entity_id TEXT,
  target_entity_id TEXT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  valid_from_chapter INTEGER,
  description TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES what_if_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (target_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS outline_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_no INTEGER,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  original_outcome TEXT,
  track_key TEXT NOT NULL,
  phase_label TEXT,
  source_type TEXT NOT NULL,
  confidence REAL,
  involved_entities_json TEXT NOT NULL,
  key_events_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outline_node_chapters (
  id TEXT PRIMARY KEY,
  outline_node_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  chapter_id TEXT,
  chapter_title TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outline_node_id) REFERENCES outline_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS future_jump_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  base_branch_id TEXT NOT NULL,
  parent_timeline_node_id TEXT,
  target_outline_node_id TEXT NOT NULL,
  target_outline_chapter_id TEXT NOT NULL,
  source_chapter_no INTEGER NOT NULL,
  target_chapter_no INTEGER NOT NULL,
  user_direction TEXT NOT NULL DEFAULT '',
  bridge_summary TEXT NOT NULL,
  generated_target_text TEXT NOT NULL,
  latest_revision_no INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES what_if_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (base_branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (target_outline_node_id) REFERENCES outline_nodes(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_outline_chapter_id) REFERENCES outline_node_chapters(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS future_jump_revisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  revision_kind TEXT NOT NULL,
  user_feedback TEXT,
  bridge_summary TEXT NOT NULL,
  generated_target_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES future_jump_runs(id) ON DELETE CASCADE,
  UNIQUE (run_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chapter_branch_no ON KnowledgeChapter(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_order ON chapter_extraction_candidates(branch_id, chapter_no, status);
CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_chapter ON chapter_extraction_candidates(branch_id, chapter_id, chapter_source_hash);
CREATE INDEX IF NOT EXISTS idx_text_span_branch_chapter ON TextSpan(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_text_span_chapter_type ON TextSpan(chapterId, spanType);
CREATE INDEX IF NOT EXISTS idx_knowledge_entity_branch_name ON KnowledgeEntity(branchId, entityType, canonicalName);
CREATE INDEX IF NOT EXISTS idx_entity_mention_branch_chapter ON EntityMention(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_entity_mention_entity_chapter ON EntityMention(branchId, entityId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_entity_link_source_valid_until ON EntityLink(branchId, sourceEntityId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_entity_link_target_valid_until ON EntityLink(branchId, targetEntityId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_entity_link_chapter ON EntityLink(branchId, sourceChapter);
CREATE INDEX IF NOT EXISTS idx_entity_link_status ON EntityLink(branchId, status);
CREATE INDEX IF NOT EXISTS idx_entity_state_entity_valid_until ON EntityState(branchId, entityId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_entity_state_status ON EntityState(branchId, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_fact_branch_source ON KnowledgeFact(branchId, sourceChapter);
CREATE INDEX IF NOT EXISTS idx_knowledge_relation_branch_valid_until ON KnowledgeRelation(branchId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_knowledge_event_branch_chapter ON KnowledgeEvent(branchId, chapterNo, importance);
CREATE INDEX IF NOT EXISTS idx_event_link_source_valid ON EventLink(branchId, sourceEventId, validFromChapter);
CREATE INDEX IF NOT EXISTS idx_event_link_target_valid ON EventLink(branchId, targetEventId, validFromChapter);
CREATE INDEX IF NOT EXISTS idx_event_link_status ON EventLink(branchId, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_world_branch_valid_until ON KnowledgeWorld(branchId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_job_novel_status ON KnowledgeJob(novelId, status);
CREATE INDEX IF NOT EXISTS idx_job_branch_status ON KnowledgeJob(branchId, status);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_label_scope ON story_timeline_nodes(novel_id, branch_id, node_type, label_index);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_anchor_chapter ON story_timeline_nodes(novel_id, branch_id, anchor_chapter_no);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_parent ON story_timeline_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_session ON story_timeline_nodes(what_if_session_id);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_run ON story_timeline_nodes(future_jump_run_id);
CREATE INDEX IF NOT EXISTS idx_what_if_sessions_branch_source ON what_if_sessions(base_branch_id, source_chapter_no);
CREATE INDEX IF NOT EXISTS idx_what_if_deltas_session ON what_if_deltas(session_id);
CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_track_sort ON outline_nodes(novel_id, branch_id, track_key, sort_order);
CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_chapter ON outline_nodes(novel_id, branch_id, chapter_no);
CREATE INDEX IF NOT EXISTS idx_outline_nodes_source_type ON outline_nodes(branch_id, source_type);
CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_outline_primary_sort ON outline_node_chapters(outline_node_id, is_primary, sort_order);
CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_chapter_anchor ON outline_node_chapters(chapter_no, chapter_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_session ON future_jump_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_parent_node ON future_jump_runs(parent_timeline_node_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline ON future_jump_runs(target_outline_node_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline_chapter ON future_jump_runs(target_outline_chapter_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_branch_target_chapter ON future_jump_runs(base_branch_id, target_chapter_no);
CREATE INDEX IF NOT EXISTS idx_future_jump_revisions_run ON future_jump_revisions(run_id);
`
