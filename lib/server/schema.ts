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
  sourceChapter INTEGER,
  confidence REAL NOT NULL DEFAULT 0.7,
  userConfirmed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  UNIQUE (entityId, alias)
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
  validToChapter INTEGER,
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
  validToChapter INTEGER,
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

CREATE TABLE IF NOT EXISTS KnowledgeWorld (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  term TEXT NOT NULL,
  category TEXT,
  definition TEXT NOT NULL,
  firstSeenChapter INTEGER,
  validFromChapter INTEGER,
  validToChapter INTEGER,
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

CREATE TABLE IF NOT EXISTS ChapterSnapshot (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterId TEXT,
  chapterNo INTEGER NOT NULL,
  snapshotJson TEXT NOT NULL,
  sourceRevisionHash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  UNIQUE (novelId, branchId, chapterNo)
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

CREATE INDEX IF NOT EXISTS idx_knowledge_chapter_branch_no ON KnowledgeChapter(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_text_span_branch_chapter ON TextSpan(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_text_span_chapter_type ON TextSpan(chapterId, spanType);
CREATE INDEX IF NOT EXISTS idx_knowledge_entity_branch_name ON KnowledgeEntity(branchId, entityType, canonicalName);
CREATE INDEX IF NOT EXISTS idx_knowledge_fact_branch_source ON KnowledgeFact(branchId, sourceChapter);
CREATE INDEX IF NOT EXISTS idx_knowledge_relation_branch_valid ON KnowledgeRelation(branchId, validFromChapter, validToChapter);
CREATE INDEX IF NOT EXISTS idx_knowledge_event_branch_chapter ON KnowledgeEvent(branchId, chapterNo, importance);
CREATE INDEX IF NOT EXISTS idx_knowledge_world_branch_valid ON KnowledgeWorld(branchId, validFromChapter, validToChapter);
CREATE INDEX IF NOT EXISTS idx_snapshot_branch_chapter_status ON ChapterSnapshot(branchId, chapterNo, status);
CREATE INDEX IF NOT EXISTS idx_job_novel_status ON KnowledgeJob(novelId, status);
CREATE INDEX IF NOT EXISTS idx_job_branch_status ON KnowledgeJob(branchId, status);
`
