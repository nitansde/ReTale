import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FULL_SCHEMA_SQL } from '@/lib/server/schema'

export const FIXTURE_NOVEL_IDS = ['novel-alpha', 'novel-beta'] as const

export type FixtureNovelId = (typeof FIXTURE_NOVEL_IDS)[number]

export type PerNovelMigrationFixture = {
  rootDir: string
  sourceDbPath: string
  targetDataDir: string
  evidenceDir: string
  baselineEvidencePath: string
  waiverEvidencePath: string
  cleanup: () => void
}

function closeDatabase(database: DatabaseSync) {
  ;(database as DatabaseSync & { close?: () => void }).close?.()
}

function insertBaseNovelGraph(database: DatabaseSync, novelId: FixtureNovelId, chapterNo: number) {
  const branchId = `${novelId}:main`
  const chapterId = `${novelId}-chapter-1`
  const sourceHash = `${novelId}-source-hash-1`
  const entityId = `${novelId}-entity-1`
  const eventId = `${novelId}-event-1`
  const factId = `${novelId}-fact-1`
  const sessionId = `${novelId}-what-if-1`
  const roleplaySessionId = `${novelId}-roleplay-1`
  const outlineNodeId = `${novelId}-outline-1`
  const outlineChapterId = `${novelId}-outline-chapter-1`
  const timelineNodeId = `${novelId}-timeline-1`
  const continueBlockId = `${novelId}-continue-1`
  const futureJumpRunId = `${novelId}-future-jump-1`

  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run(novelId, `${novelId} title`, `${novelId} author`, 'txt')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run(branchId, novelId, 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    chapterId,
    novelId,
    branchId,
    chapterNo,
    `${novelId} chapter ${chapterNo}`,
    `${novelId} raw chapter text ${chapterNo}`,
    `${novelId} summary ${chapterNo}`,
    1,
    0,
    null,
    sourceHash,
    'ready'
  )

  database.prepare(
    `INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-line-1`, chapterId, 1, `${novelId} line 1`, 0, 14)

  database.prepare(
    `INSERT INTO TextSpan (
      id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
      charStart, charEnd, text, spanType, tokenEstimate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-span-1`, novelId, branchId, chapterId, chapterNo, 1, 1, 0, 14, `${novelId} span 1`, 'paragraph', 8)

  database.prepare(
    `INSERT INTO chapter_extraction_candidates (
      id, novel_id, branch_id, chapter_id, chapter_no, chapter_revision,
      chapter_source_hash, extraction_json, processing_result_json, status, provider, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-extract-1`,
    novelId,
    branchId,
    chapterId,
    chapterNo,
    1,
    sourceHash,
    JSON.stringify({ novelId, chapterId }),
    JSON.stringify({ status: 'ready' }),
    'extracted',
    'fixture',
    'fixture-model'
  )

  database.prepare(
    `INSERT INTO hanlp_bootstrap_cache (
      id, novel_id, branch_id, chapter_id, chapter_no, chapter_text_hash,
      hanlp_script_version_hash, hanlp_model_or_config_hash, output_schema_version,
      cache_key, input_hash, pipeline_version, source_chapter_id, source_chapter_no,
      request_json, result_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-hanlp-cache-1`,
    novelId,
    branchId,
    chapterId,
    chapterNo,
    `${novelId}-chapter-text-hash`,
    'script-hash',
    'model-hash',
    'v1',
    `${novelId}-cache-key`,
    `${novelId}-input-hash`,
    'v1',
    chapterId,
    chapterNo,
    JSON.stringify({ novelId }),
    JSON.stringify({ entities: 1 }),
    'ready'
  )

  database.prepare(
    `INSERT INTO KnowledgeEntity (
      id, novelId, branchId, entityType, canonicalName, description,
      firstSeenChapter, lastSeenChapter, importanceTier, status, importance, userConfirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(entityId, novelId, branchId, 'character', `${novelId} hero`, `${novelId} entity`, chapterNo, chapterNo, 'protagonist', 'active', 5, 1)

  database.prepare(
    `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, progress, currentStep, payloadJson, errorMessage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-job-1`, novelId, branchId, 'extract_chapter_knowledge', 'queued', 0, 'pending', JSON.stringify({ novelId, branchId, chapterId }), null)

  database.prepare(
    `INSERT INTO hanlp_bootstrap_results (
      id, novel_id, branch_id, knowledge_job_id, chapter_id, chapter_no,
      chapter_source_hash, result_kind, provider, model, result_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-hanlp-result-1`,
    novelId,
    branchId,
    `${novelId}-job-1`,
    chapterId,
    chapterNo,
    sourceHash,
    'bootstrap',
    'fixture',
    'fixture-model',
    JSON.stringify({ novelId, chapterId, entities: [entityId] }),
    'ready'
  )

  database.prepare(
    `INSERT INTO hanlp_bootstrap_entities (
      id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
      total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-hanlp-entity-1`,
    novelId,
    branchId,
    chapterId,
    chapterNo,
    `${novelId} hero`,
    'character',
    1,
    1,
    1,
    0.99,
    `${novelId}-hanlp-cache-1`,
    `${novelId}-hanlp-result-1`
  )

  database.prepare(
    `INSERT INTO hanlp_bootstrap_coverage (id, novel_id, valid_through_chapter_no)
     VALUES (?, ?, ?)`
  ).run(`${novelId}-hanlp-coverage-1`, novelId, chapterNo)

  database.prepare(
    `INSERT INTO character_candidates (
      id, novel_id, branch_id, surface_text, first_seen_chapter, last_seen_chapter,
      chapter_count, mention_count, observations_json, status, promoted_entity_id,
      promotion_summary_status, promotion_summary_generated_at, merged_entity_id,
      display_name, normalized_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-candidate-1`,
    novelId,
    branchId,
    `${novelId} hero`,
    chapterNo,
    chapterNo,
    1,
    1,
    JSON.stringify([{ chapterNo }]),
    'collecting',
    entityId,
    'ready',
    '2026-01-01T00:00:00.000Z',
    null,
    `${novelId} hero`,
    `${novelId}-hero`
  )

  database.prepare(
    `INSERT INTO character_candidate_chapters (
      id, novel_id, branch_id, candidate_id, chapter_no, mention_count,
      best_observation, best_evidence, chapter_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-candidate-chapter-1`,
    novelId,
    branchId,
    `${novelId}-candidate-1`,
    chapterNo,
    1,
    `${novelId} observation`,
    `${novelId} evidence`,
    chapterId
  )

  database.prepare(
    `INSERT INTO EntityAlias (id, entityId, alias, evidenceSpanId, evidenceQuote, sourceChapter, confidence, userConfirmed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-alias-1`, entityId, `${novelId} alias`, `${novelId}-span-1`, `${novelId} alias quote`, chapterNo, 0.92, 1)

  database.prepare(
    `INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-alias-map-1`, novelId, branchId, `${novelId} alias`, entityId, `${novelId}-alias-1`, chapterNo)

  database.prepare(
    `INSERT INTO EntityAliasConflictLog (
      id, novelId, branchId, alias, existingEntityId, attemptedEntityId,
      existingCanonicalName, attemptedCanonicalName, sourceAliasId, sourceChapter,
      conflictReason, detailsJson
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-alias-conflict-1`,
    novelId,
    branchId,
    `${novelId} alias`,
    entityId,
    entityId,
    `${novelId} hero`,
    `${novelId} hero`,
    `${novelId}-alias-1`,
    chapterNo,
    'branch_alias_already_claimed',
    JSON.stringify({ novelId })
  )

  database.prepare(
    `INSERT INTO EntityMention (
      id, novelId, branchId, chapterId, chapterNo, entityId, mentionText,
      resolutionKind, evidenceSpanId, evidenceQuote
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-mention-1`,
    novelId,
    branchId,
    chapterId,
    chapterNo,
    entityId,
    `${novelId} hero`,
    'resolved',
    `${novelId}-span-1`,
    `${novelId} mention quote`
  )

  database.prepare(
    `INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd, evidenceSpanId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-appearance-1`, entityId, chapterId, chapterNo, 1, 1, `${novelId}-span-1`)

  database.prepare(
    `INSERT INTO EntityLink (
      id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label,
      description, polarity, strength, weight, sourceChapter, validFromChapter,
      validUntilChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-entity-link-1`,
    novelId,
    branchId,
    entityId,
    entityId,
    'self',
    `${novelId} link`,
    `${novelId} link description`,
    'ally',
    1,
    1,
    chapterNo,
    chapterNo,
    chapterNo,
    `${novelId}-span-1`,
    `${novelId} link quote`,
    0.8,
    'ai_generated',
    1
  )

  database.prepare(
    `INSERT INTO EntityState (
      id, novelId, branchId, entityId, stateType, stateValue, description,
      sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId,
      evidenceQuote, confidence, status, includeByDefault
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-entity-state-1`,
    novelId,
    branchId,
    entityId,
    'mood',
    'focused',
    `${novelId} state`,
    chapterNo,
    chapterNo,
    chapterNo,
    `${novelId}-span-1`,
    `${novelId} state quote`,
    0.77,
    'ai_generated',
    1
  )

  database.prepare(
    `INSERT INTO KnowledgeFact (
      id, novelId, branchId, factType, subjectEntityId, predicate,
      objectEntityId, valueJson, sourceChapter, validFromChapter,
      validUntilChapter, confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    factId,
    novelId,
    branchId,
    'trait',
    entityId,
    'status',
    null,
    JSON.stringify({ value: 'active' }),
    chapterNo,
    chapterNo,
    chapterNo,
    0.81,
    'ai_generated'
  )

  database.prepare(
    `INSERT INTO FactEvidence (id, factId, chapterId, chapterNo, lineStart, lineEnd, quote, evidenceSpanId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-fact-evidence-1`, factId, chapterId, chapterNo, 1, 1, `${novelId} fact quote`, `${novelId}-span-1`)

  database.prepare(
    `INSERT INTO KnowledgeRelation (
      id, novelId, branchId, sourceEntityId, targetEntityId, relationType,
      polarity, strength, sourceChapter, validFromChapter, validUntilChapter,
      evidenceSpanId, confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-relation-1`,
    novelId,
    branchId,
    entityId,
    entityId,
    'identity',
    'neutral',
    1,
    chapterNo,
    chapterNo,
    chapterNo,
    `${novelId}-span-1`,
    0.73,
    'ai_generated'
  )

  database.prepare(
    `INSERT INTO KnowledgeEvent (
      id, novelId, branchId, name, summary, eventType, chapterNo,
      lineStart, lineEnd, importance, consequences, evidenceSpanId, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    novelId,
    branchId,
    `${novelId} event`,
    `${novelId} event summary`,
    'plot',
    chapterNo,
    1,
    1,
    3,
    `${novelId} event consequence`,
    `${novelId}-span-1`,
    'ai_generated'
  )

  database.prepare(
    `INSERT INTO EventParticipant (id, eventId, entityId, role)
     VALUES (?, ?, ?, ?)`
  ).run(`${novelId}-event-participant-1`, eventId, entityId, 'lead')

  database.prepare(
    `INSERT INTO EventLink (
      id, novelId, branchId, sourceEventId, targetEventId, linkType,
      label, description, sourceChapter, validFromChapter, evidenceSpanId,
      evidenceQuote, confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-event-link-1`,
    novelId,
    branchId,
    eventId,
    eventId,
    'follows',
    `${novelId} event link`,
    `${novelId} event link description`,
    chapterNo,
    chapterNo,
    `${novelId}-span-1`,
    `${novelId} event link quote`,
    0.75,
    'ai_generated'
  )

  database.prepare(
    `INSERT INTO KnowledgeWorld (
      id, novelId, branchId, term, category, definition,
      firstSeenChapter, validFromChapter, validUntilChapter,
      evidenceSpanId, status, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-world-1`,
    novelId,
    branchId,
    `${novelId} world`,
    'location',
    `${novelId} world definition`,
    chapterNo,
    chapterNo,
    chapterNo,
    `${novelId}-span-1`,
    'ai_generated',
    0.82
  )

  database.prepare(
    `INSERT INTO RawTextEmbeddingCache (
      branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(branchId, 'fixture-provider', 'fixture-model', `${novelId}-embedding-hash`, JSON.stringify([0.1, 0.2, 0.3]), 3)

  database.prepare(
    `INSERT INTO ActiveRetrievalIndex (branchId, scopeKey, tableName, scopeStartChapter, scopeEndChapter)
     VALUES (?, ?, ?, ?, ?)`
  ).run(branchId, 'full', `${novelId}_retrieval_active`, chapterNo, chapterNo)

  database.prepare(
    `INSERT INTO PendingRetrievalIndex (
      branchId, scopeKey, tableName, phase, rowCount,
      textIndexCompleted, vectorIndexCompleted, rebuildFingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(branchId, 'chapter-range:1:1', `${novelId}_retrieval_pending`, 'pending_rebuild', 1, 0, 0, `${novelId}-pending-fingerprint`)

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no,
      title, subtitle, parent_node_id, source_chapter_no, target_chapter_no,
      chapter_id, continue_block_id, what_if_session_id, future_jump_run_id,
      roleplay_session_id, readable_label, readable_lineage_label, lane_index,
      color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    timelineNodeId,
    novelId,
    branchId,
    'chapter',
    1,
    chapterNo,
    `${novelId} timeline`,
    `${novelId} timeline subtitle`,
    null,
    chapterNo,
    chapterNo,
    chapterId,
    null,
    null,
    null,
    null,
    `${novelId} label`,
    `${novelId} lineage`,
    0,
    'blue',
    'active'
  )

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no,
      title, subtitle, user_instruction, selected_text, original_text,
      latest_text, latest_input_tokens, latest_output_tokens,
      latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    continueBlockId,
    novelId,
    branchId,
    timelineNodeId,
    chapterNo,
    `${novelId} continue`,
    `${novelId} continue subtitle`,
    `${novelId} instruction`,
    `${novelId} selected`,
    `${novelId} original`,
    `${novelId} latest`,
    10,
    20,
    1,
    'active'
  )

  database.prepare(
    `INSERT INTO continue_block_revisions (
      id, continue_block_id, revision_no, revision_kind, user_instruction,
      selected_text, original_text, generated_text, input_tokens,
      output_tokens, title, subtitle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-continue-revision-1`,
    continueBlockId,
    1,
    'initial',
    `${novelId} instruction`,
    `${novelId} selected`,
    `${novelId} original`,
    `${novelId} generated`,
    10,
    20,
    `${novelId} continue`,
    `${novelId} continue subtitle`
  )

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, input_tokens,
      output_tokens, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    novelId,
    branchId,
    chapterNo,
    `${novelId} what-if`,
    `${novelId} premise`,
    `${novelId} selected`,
    `${novelId} original`,
    `${novelId} generated`,
    11,
    21,
    'active'
  )

  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name,
      subject_entity_id, target_entity_id, key, old_value, new_value,
      valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-what-if-delta-1`,
    sessionId,
    'state',
    `${novelId} hero`,
    null,
    entityId,
    null,
    'mood',
    'neutral',
    'changed',
    chapterNo,
    `${novelId} delta`,
    0.8
  )

  database.prepare(
    `INSERT INTO roleplay_sessions (
      id, novel_id, branch_id, title, subtitle, source_chapter_id,
      source_chapter_no, source_chapter_title, source_timeline_node_id,
      source_timeline_node_type, source_selected_text, source_text_snapshot,
      source_selected_line_start, source_selected_line_end, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    roleplaySessionId,
    novelId,
    branchId,
    `${novelId} roleplay`,
    `${novelId} roleplay subtitle`,
    chapterId,
    chapterNo,
    `${novelId} chapter ${chapterNo}`,
    timelineNodeId,
    'chapter',
    `${novelId} selected`,
    `${novelId} snapshot`,
    1,
    1,
    'active'
  )

  database.prepare(
    `INSERT INTO roleplay_messages (
      id, session_id, message_index, turn_index, variant_index, role,
      content, parent_message_id, forked_from_message_id, variant_group_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${novelId}-roleplay-message-1`, roleplaySessionId, 1, 1, 1, 'user', `${novelId} roleplay message`, null, null, `${novelId}-variant-1`, 'active')

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary,
      original_outcome, track_key, phase_label, source_type,
      confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    outlineNodeId,
    novelId,
    branchId,
    chapterNo,
    `${novelId} outline`,
    `${novelId} outline summary`,
    `${novelId} outcome`,
    'main',
    'setup',
    'generated',
    0.9,
    JSON.stringify([entityId]),
    JSON.stringify([eventId]),
    1
  )

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(outlineChapterId, outlineNodeId, chapterNo, chapterId, `${novelId} chapter ${chapterNo}`, 1, 1)

  database.prepare(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, source_timeline_node_id,
      source_timeline_node_type, source_chapter_id, source_what_if_session_id,
      target_outline_node_id, target_outline_chapter_id, source_chapter_no,
      target_chapter_no, user_direction, bridge_summary, generated_target_text,
      latest_input_tokens, latest_output_tokens, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    futureJumpRunId,
    sessionId,
    branchId,
    timelineNodeId,
    timelineNodeId,
    'chapter',
    chapterId,
    sessionId,
    outlineNodeId,
    outlineChapterId,
    chapterNo,
    chapterNo + 1,
    `${novelId} direction`,
    `${novelId} bridge`,
    `${novelId} generated target`,
    12,
    22,
    1,
    null,
    'pending'
  )

  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback,
      bridge_summary, generated_target_text, input_tokens, output_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${novelId}-future-jump-revision-1`,
    futureJumpRunId,
    1,
    'initial',
    `${novelId} feedback`,
    `${novelId} bridge`,
    `${novelId} generated target`,
    12,
    22
  )
}

export function createPerNovelMigrationFixture(prefix: string): PerNovelMigrationFixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const sourceDbPath = path.join(rootDir, 'legacy-monolith.db')
  const targetDataDir = path.join(rootDir, 'data')
  const evidenceDir = path.join(rootDir, 'evidence')
  const baselineEvidencePath = path.join(evidenceDir, 'task-1-prechange-baseline.txt')
  const waiverEvidencePath = path.join(evidenceDir, 'task-1-no-backup-waiver.txt')
  const database = new DatabaseSync(sourceDbPath)

  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec(FULL_SCHEMA_SQL)

  database.prepare('INSERT INTO AppSetting (id, key, value) VALUES (?, ?, ?)').run('app-setting-1', 'AI_SETTINGS_V2', JSON.stringify({ provider: 'fixture' }))
  database.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', JSON.stringify({ currentNovelId: 'novel-alpha', localNovels: FIXTURE_NOVEL_IDS }))
  database.prepare(
    `INSERT INTO WorkspaceStateBackup (id, workspaceStateId, payload, reason, sourceUpdatedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run('workspace-backup-1', 'singleton', JSON.stringify({ backup: true, novels: FIXTURE_NOVEL_IDS }), 'overwrite', '2026-01-01T00:00:00.000Z')
  database.prepare(
    `INSERT INTO WorkspaceKnowledgeSyncState (
      workspaceStateId, requestedRevision, startedRevision, syncedRevision,
      requestedSourceUpdatedAt, startedSourceUpdatedAt, startedAt,
      syncedSourceUpdatedAt, lastError
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('singleton', 2, 2, 2, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:03.000Z', null)
  database.prepare(
    `INSERT INTO WorkspaceRuntimeState (
      id, currentNovelId, currentChapterId, currentTab, helperTab,
      expandedVolumeIdsJson, localOutlinesJson, localCharactersJson,
      localCharacterRelationsJson, localWorldEntriesJson, localTimelineEventsJson,
      rewriteCandidatesJson, rewriteHistoryJson, trajectoriesJson, rewriteMode,
      rewriteTone, rewriteOutput, rewriteScope, selectionText, selectedParagraphIndex,
      thinkingLevel, autoContinue, keepCanon, promptText, selectedPresetId,
      presetsJson, constraintsJson, focusMode, presetCompatSessionStateJson
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'singleton',
    'novel-alpha',
    'novel-alpha-runtime-chapter-1',
    'editor',
    'ai',
    JSON.stringify(['novel-alpha-volume-1', 'novel-beta-volume-1']),
    JSON.stringify([{ novelId: 'novel-alpha' }, { novelId: 'novel-beta' }]),
    JSON.stringify([{ novelId: 'novel-alpha' }, { novelId: 'novel-beta' }]),
    JSON.stringify([]),
    JSON.stringify([{ novelId: 'novel-alpha' }, { novelId: 'novel-beta' }]),
    JSON.stringify([{ novelId: 'novel-alpha' }, { novelId: 'novel-beta' }]),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    'medium',
    'keep',
    'candidate',
    'paragraph',
    '',
    0,
    'medium',
    1,
    1,
    'fixture prompt',
    '',
    JSON.stringify([]),
    JSON.stringify([]),
    0,
    JSON.stringify({})
  )

  database.prepare(
    `INSERT INTO WorkspaceRuntimeNovel (workspaceStateId, id, title, summary, tagsJson, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('singleton', 'novel-alpha', 'novel-alpha title', 'alpha summary', JSON.stringify(['alpha']), 1)
  database.prepare(
    `INSERT INTO WorkspaceRuntimeNovel (workspaceStateId, id, title, summary, tagsJson, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('singleton', 'novel-beta', 'novel-beta title', 'beta summary', JSON.stringify(['beta']), 2)

  database.prepare(
    `INSERT INTO WorkspaceRuntimeVolume (workspaceStateId, id, novelId, title, sortOrder)
     VALUES (?, ?, ?, ?, ?)`
  ).run('singleton', 'novel-alpha-volume-1', 'novel-alpha', 'Alpha Volume', 1)
  database.prepare(
    `INSERT INTO WorkspaceRuntimeVolume (workspaceStateId, id, novelId, title, sortOrder)
     VALUES (?, ?, ?, ?, ?)`
  ).run('singleton', 'novel-beta-volume-1', 'novel-beta', 'Beta Volume', 1)

  database.prepare(
    `INSERT INTO WorkspaceRuntimeChapter (
      workspaceStateId, id, novelId, volumeId, parentChapterId, kind,
      branchLabel, title, sortOrder, contentHtml, originalContentHtml,
      status, wordCount, updatedAtLabel, trajectoryJson
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('singleton', 'novel-alpha-runtime-chapter-1', 'novel-alpha', 'novel-alpha-volume-1', null, 'chapter', 'main', 'Alpha Runtime Chapter', 1, '<p>alpha</p>', null, 'draft', 10, 'now', JSON.stringify([]))
  database.prepare(
    `INSERT INTO WorkspaceRuntimeChapter (
      workspaceStateId, id, novelId, volumeId, parentChapterId, kind,
      branchLabel, title, sortOrder, contentHtml, originalContentHtml,
      status, wordCount, updatedAtLabel, trajectoryJson
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('singleton', 'novel-beta-runtime-chapter-1', 'novel-beta', 'novel-beta-volume-1', null, 'chapter', 'main', 'Beta Runtime Chapter', 1, '<p>beta</p>', null, 'draft', 10, 'now', JSON.stringify([]))

  insertBaseNovelGraph(database, 'novel-alpha', 1)
  insertBaseNovelGraph(database, 'novel-beta', 2)

  closeDatabase(database)
  fs.mkdirSync(evidenceDir, { recursive: true })

  return {
    rootDir,
    sourceDbPath,
    targetDataDir,
    evidenceDir,
    baselineEvidencePath,
    waiverEvidencePath,
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true })
    },
  }
}

export function writeBaselineAndWaiverEvidence(fixture: PerNovelMigrationFixture) {
  fs.mkdirSync(fixture.evidenceDir, { recursive: true })
  fs.writeFileSync(fixture.waiverEvidencePath, 'continue，不需要备份数据库\n')
  fs.writeFileSync(
    fixture.baselineEvidencePath,
    [
      `sourceDbPath=${fixture.sourceDbPath}`,
      'baselineCaptured=true',
      `novelIds=${FIXTURE_NOVEL_IDS.join(',')}`,
    ].join('\n')
  )
}

export function listTableNames(databasePath: string) {
  const database = new DatabaseSync(databasePath)
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
    .all() as Array<{ name: string }>
  closeDatabase(database)
  return rows.map((row) => row.name)
}

export function queryCount(databasePath: string, sql: string, ...params: Array<string | number | null>) {
  const database = new DatabaseSync(databasePath)
  const row = database.prepare(sql).get(...params) as { count: number }
  closeDatabase(database)
  return row.count
}
