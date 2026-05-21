export const PROTECTED_RESET_APP_SETTING_KEYS = [
  'PRESET_COMPAT_LIBRARY_V1',
  'AI_SETTINGS_V2',
  'OLLAMA_TIMEOUT_MS',
] as const

const CHARACTER_IMPORTANCE_TIER_SQL = "'protagonist', 'important', 'arc', 'candidate', 'ignored'"

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
  processing_result_json TEXT,
  status TEXT NOT NULL DEFAULT 'extracted',
  provider TEXT,
  model TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(branch_id, chapter_id, chapter_source_hash)
);

CREATE TABLE IF NOT EXISTS hanlp_bootstrap_cache (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_id TEXT,
  chapter_no INTEGER,
  chapter_text_hash TEXT NOT NULL,
  hanlp_script_version_hash TEXT NOT NULL,
  hanlp_model_or_config_hash TEXT NOT NULL,
  output_schema_version TEXT NOT NULL DEFAULT 'v1',
  cache_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  pipeline_version TEXT NOT NULL DEFAULT 'v1',
  source_chapter_id TEXT,
  source_chapter_no INTEGER,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (source_chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  UNIQUE (branch_id, input_hash, pipeline_version)
);

CREATE TABLE IF NOT EXISTS hanlp_bootstrap_results (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  knowledge_job_id TEXT,
  chapter_id TEXT,
  chapter_no INTEGER,
  chapter_source_hash TEXT NOT NULL,
  result_kind TEXT NOT NULL DEFAULT 'bootstrap',
  provider TEXT,
  model TEXT,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (knowledge_job_id) REFERENCES KnowledgeJob(id) ON DELETE SET NULL,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  UNIQUE (branch_id, chapter_id, chapter_source_hash, result_kind)
);

CREATE TABLE IF NOT EXISTS hanlp_bootstrap_entities (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_id TEXT,
  chapter_no INTEGER,
  entity_text TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 1,
  chapter_count INTEGER NOT NULL DEFAULT 1,
  coverage_ratio REAL NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  source_cache_id TEXT,
  source_result_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (source_cache_id) REFERENCES hanlp_bootstrap_cache(id) ON DELETE SET NULL,
  FOREIGN KEY (source_result_id) REFERENCES hanlp_bootstrap_results(id) ON DELETE SET NULL,
  UNIQUE (branch_id, chapter_id, entity_text, entity_type, source_result_id)
);

CREATE TABLE IF NOT EXISTS character_candidates (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  surface_text TEXT NOT NULL,
  first_seen_chapter INTEGER NOT NULL,
  last_seen_chapter INTEGER NOT NULL,
  chapter_count INTEGER NOT NULL DEFAULT 1,
  mention_count INTEGER NOT NULL DEFAULT 1,
  observations_json TEXT,
  status TEXT NOT NULL DEFAULT 'collecting',
  promoted_entity_id TEXT,
  promotion_summary_status TEXT NOT NULL DEFAULT 'not_requested',
  promotion_summary_generated_at TEXT,
  merged_entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (promoted_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (merged_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  UNIQUE (novel_id, branch_id, surface_text),
  UNIQUE (branch_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS character_candidate_chapters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 1,
  best_observation TEXT,
  best_evidence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  chapter_id TEXT,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES character_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  UNIQUE (novel_id, branch_id, candidate_id, chapter_no)
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
  importanceTier TEXT CHECK (importanceTier IS NULL OR (entityType = 'character' AND importanceTier IN (${CHARACTER_IMPORTANCE_TIER_SQL}))),
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

CREATE TABLE IF NOT EXISTS EntityAliasMapping (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  alias TEXT NOT NULL,
  entityId TEXT NOT NULL,
  sourceAliasId TEXT,
  sourceChapter INTEGER,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceAliasId) REFERENCES EntityAlias(id) ON DELETE SET NULL,
  UNIQUE (branchId, alias)
);

CREATE TABLE IF NOT EXISTS EntityAliasConflictLog (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  alias TEXT NOT NULL,
  existingEntityId TEXT,
  attemptedEntityId TEXT,
  existingCanonicalName TEXT,
  attemptedCanonicalName TEXT,
  sourceAliasId TEXT,
  sourceChapter INTEGER,
  conflictReason TEXT NOT NULL DEFAULT 'branch_alias_already_claimed',
  detailsJson TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (existingEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (attemptedEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (sourceAliasId) REFERENCES EntityAlias(id) ON DELETE SET NULL
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
  continue_block_id TEXT,
  what_if_session_id TEXT,
  future_jump_run_id TEXT,
  readable_label TEXT,
  readable_lineage_label TEXT,
  lane_index INTEGER DEFAULT 0,
  color_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (continue_block_id) REFERENCES continue_blocks(id) ON DELETE SET NULL,
  FOREIGN KEY (what_if_session_id) REFERENCES what_if_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (future_jump_run_id) REFERENCES future_jump_runs(id) ON DELETE SET NULL,
  UNIQUE (novel_id, branch_id, node_type, label_index),
  UNIQUE (continue_block_id),
  UNIQUE (what_if_session_id),
  UNIQUE (future_jump_run_id)
);

CREATE TABLE IF NOT EXISTS continue_blocks (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  parent_timeline_node_id TEXT,
  source_chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  user_instruction TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  latest_text TEXT NOT NULL,
  latest_input_tokens INTEGER,
  latest_output_tokens INTEGER,
  latest_revision_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS continue_block_revisions (
  id TEXT PRIMARY KEY,
  continue_block_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  revision_kind TEXT NOT NULL,
  user_instruction TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  title TEXT NOT NULL,
  subtitle TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (continue_block_id) REFERENCES continue_blocks(id) ON DELETE CASCADE,
  UNIQUE (continue_block_id, revision_no)
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
  input_tokens INTEGER,
  output_tokens INTEGER,
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
  source_timeline_node_id TEXT,
  source_timeline_node_type TEXT,
  source_chapter_id TEXT,
  source_what_if_session_id TEXT,
  target_outline_node_id TEXT NOT NULL,
  target_outline_chapter_id TEXT NOT NULL,
  source_chapter_no INTEGER NOT NULL,
  target_chapter_no INTEGER NOT NULL,
  user_direction TEXT NOT NULL DEFAULT '',
  bridge_summary TEXT NOT NULL,
  generated_target_text TEXT NOT NULL,
  latest_input_tokens INTEGER,
  latest_output_tokens INTEGER,
  latest_revision_no INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES what_if_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (base_branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (source_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (source_chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (source_what_if_session_id) REFERENCES what_if_sessions(id) ON DELETE SET NULL,
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
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES future_jump_runs(id) ON DELETE CASCADE,
  UNIQUE (run_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chapter_branch_no ON KnowledgeChapter(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_order ON chapter_extraction_candidates(branch_id, chapter_no, status);
CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_chapter ON chapter_extraction_candidates(branch_id, chapter_id, chapter_source_hash);
CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_cache_last_seen ON hanlp_bootstrap_cache(branch_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_results_lookup ON hanlp_bootstrap_results(branch_id, chapter_id, chapter_source_hash, result_kind);
CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_results_job ON hanlp_bootstrap_results(knowledge_job_id, status);
CREATE INDEX IF NOT EXISTS idx_character_candidate_chapters_candidate_count ON character_candidate_chapters(candidate_id, chapter_no);
CREATE INDEX IF NOT EXISTS idx_character_candidate_chapters_branch_chapter ON character_candidate_chapters(branch_id, chapter_no, candidate_id);
CREATE INDEX IF NOT EXISTS idx_text_span_branch_chapter ON TextSpan(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_text_span_chapter_type ON TextSpan(chapterId, spanType);
CREATE INDEX IF NOT EXISTS idx_knowledge_entity_branch_name ON KnowledgeEntity(branchId, entityType, canonicalName);
CREATE INDEX IF NOT EXISTS idx_entity_alias_mapping_branch_alias ON EntityAliasMapping(branchId, alias);
CREATE INDEX IF NOT EXISTS idx_entity_alias_mapping_branch_entity ON EntityAliasMapping(branchId, entityId);
CREATE INDEX IF NOT EXISTS idx_entity_alias_conflict_branch_alias ON EntityAliasConflictLog(branchId, alias, createdAt);
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
CREATE INDEX IF NOT EXISTS idx_continue_blocks_branch_source ON continue_blocks(branch_id, source_chapter_no);
CREATE INDEX IF NOT EXISTS idx_continue_blocks_parent_node ON continue_blocks(parent_timeline_node_id);
CREATE INDEX IF NOT EXISTS idx_continue_block_revisions_block ON continue_block_revisions(continue_block_id);
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
