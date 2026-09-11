import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { getNovelDb, getNovelStoragePaths, resetResolvedDatabasesForTests } from '@/lib/server/db-resolver'
import { createWorkspaceNovelFromSnapshot } from '@/lib/server/workspace-mutation'
import { readWorkspaceRuntimeSnapshotFromDb } from '@/lib/server/workspace-resilience'
import { planPersistedTextRepair } from '@/lib/server/persisted-text-repair-plan'
import { repairPersistedEntityText } from '@/lib/server/persisted-text-repair'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import { hashContent } from '@/lib/server/knowledge-store'

const directories: string[] = []
const originalDataDir = process.env.RETALE_DATA_DIR
const novelId = 'novel-text-repair'
const html = '<p>A &amp; B &lt;C&gt;</p>'
const legacy = 'A &amp; B &lt;C&gt;'
const decoded = 'A & B <C>'
const count = (text: string) => text.replace(/\s/g, '').length

afterEach(() => {
  resetResolvedDatabasesForTests()
  if (originalDataDir === undefined) delete process.env.RETALE_DATA_DIR
  else process.env.RETALE_DATA_DIR = originalDataDir
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-text-repair-'))
  directories.push(directory)
  process.env.RETALE_DATA_DIR = path.join(directory, 'data')
  resetResolvedDatabasesForTests()
  await createWorkspaceNovelFromSnapshot({
    novelId,
    payload: normalizeWorkspaceState({
      currentNovelId: novelId,
      localNovels: [{ id: novelId, title: 'Text repair', summary: '', tags: [] }],
      localChapters: [
        { id: 'chapter-encoded', novelId, title: 'Encoded', order: 1, content: html, wordCount: count(legacy), status: 'draft', updatedAt: 'original' },
        { id: 'chapter-literal', novelId, title: 'Literal', order: 2, content: '<p>Unrelated text</p>', wordCount: 999, status: 'draft', updatedAt: 'original' },
      ],
    }),
  })
  const raw = getNovelDb(novelId)
  raw.prepare("UPDATE KnowledgeChapter SET rawText = ?, sourceHash = ?, revision = 3, isDirty = 0, knowledgeStatus = 'ready' WHERE id = 'chapter-encoded'").run(legacy, hashContent(decoded))
  raw.prepare("UPDATE ChapterLine SET text = ? WHERE chapterId = 'chapter-encoded'").run(legacy)
  raw.prepare("UPDATE TextSpan SET text = ? WHERE chapterId = 'chapter-encoded'").run(legacy)
  return { raw, db: createNovelDatabaseAccess(novelId), directory }
}

function readState() {
  const db = createNovelDatabaseAccess(novelId)
  return {
    runtime: readWorkspaceRuntimeSnapshotFromDb(db),
    artifact: db.queryOne('SELECT payload, revision FROM WorkspaceState'),
    backups: db.queryAll('SELECT payload, revision FROM WorkspaceStateBackup ORDER BY id'),
    knowledge: db.queryAll('SELECT id, rawText, sourceHash, revision, isDirty, knowledgeStatus FROM KnowledgeChapter ORDER BY id'),
    lines: db.queryAll('SELECT * FROM ChapterLine ORDER BY chapterId, lineNo'),
    sync: db.queryOne('SELECT * FROM WorkspaceKnowledgeSyncState'),
  }
}

describe('scoped persisted entity repair', () => {
  it('repairs proven entity differences through the workspace snapshot, leaves unrelated counts, and is idempotent', async () => {
    const { db, raw } = await fixture()
    const preview = planPersistedTextRepair(db, novelId)
    expect(preview).toMatchObject({ workspaceRevision: 1, blockers: [], repairs: [{ chapterId: 'chapter-encoded', repairRawText: true, repairWordCount: true }] })
    expect(preview.skippedCounts).toEqual([{ chapterId: 'chapter-literal', storedWordCount: 999, derivedWordCount: 13 }])
    const originalArtifact = db.queryOne<{ payload: string }>('SELECT payload FROM WorkspaceState')!.payload
    const result = await repairPersistedEntityText(novelId, 1)
    expect(result).toMatchObject({ applied: true, workspaceRevision: 2, knowledgeRebuildRequired: true })
    expect(db.queryOne('SELECT rawText, sourceHash, revision, knowledgeStatus FROM KnowledgeChapter WHERE id = ?', 'chapter-encoded'))
      .toEqual({ rawText: decoded, sourceHash: hashContent(decoded), revision: 4, knowledgeStatus: 'stale' })
    expect(db.queryAll('SELECT text FROM ChapterLine WHERE chapterId = ?', 'chapter-encoded')).toEqual([{ text: decoded }])
    expect(db.queryAll('SELECT DISTINCT text FROM TextSpan WHERE chapterId = ?', 'chapter-encoded')).toEqual([{ text: decoded }])
    const runtime = readWorkspaceRuntimeSnapshotFromDb(db)!
    expect(runtime.payload.localChapters[0]).toMatchObject({ content: html, wordCount: count(decoded), updatedAt: 'original' })
    expect(runtime.payload.localChapters[1].wordCount).toBe(999)
    const artifact = db.queryOne<{ payload: string; revision: number }>('SELECT payload, revision FROM WorkspaceState')!
    expect(artifact.revision).toBe(runtime.revision)
    expect(JSON.parse(artifact.payload).localChapters).toEqual(runtime.payload.localChapters)
    expect(db.queryOne('SELECT payload FROM WorkspaceStateBackup ORDER BY id DESC LIMIT 1')).toEqual({ payload: originalArtifact })
    const sync = raw.prepare('SELECT requestedRevision, syncedRevision, startedRevision FROM WorkspaceKnowledgeSyncState').get()!
    expect(sync.requestedRevision).toBe(sync.syncedRevision)
    expect(sync.startedRevision).toBeNull()
    const before = readState()
    await expect(repairPersistedEntityText(novelId, 2)).resolves.toMatchObject({ applied: false })
    expect(readState()).toEqual(before)
  })

  it('repairs raw text without changing an already-correct workspace count or revision', async () => {
    const { raw } = await fixture()
    raw.prepare("UPDATE WorkspaceRuntimeChapter SET wordCount = ? WHERE id = 'chapter-encoded'").run(count(decoded))
    await expect(repairPersistedEntityText(novelId, 1)).resolves.toMatchObject({ applied: true, workspaceRevision: 1 })
    expect(planPersistedTextRepair(createNovelDatabaseAccess(novelId), novelId).repairs).toEqual([])
  })

  it('refreshes a confirmed entity-repair chapter count even when its historical count uses another convention', async () => {
    const { raw } = await fixture()
    raw.prepare("UPDATE WorkspaceRuntimeChapter SET wordCount = 1234 WHERE id = 'chapter-encoded'").run()
    await expect(repairPersistedEntityText(novelId, 1)).resolves.toMatchObject({ applied: true, workspaceRevision: 2 })
    expect(raw.prepare("SELECT wordCount FROM WorkspaceRuntimeChapter WHERE id = 'chapter-encoded'").get()).toEqual({ wordCount: count(decoded) })
    expect(raw.prepare("SELECT wordCount FROM WorkspaceRuntimeChapter WHERE id = 'chapter-literal'").get()).toEqual({ wordCount: 999 })
  })

  it('lets one concurrent repair commit and rejects the other stale revision', async () => {
    await fixture()
    const results = await Promise.allSettled([repairPersistedEntityText(novelId, 1), repairPersistedEntityText(novelId, 1)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(readWorkspaceRuntimeSnapshotFromDb(createNovelDatabaseAccess(novelId))!.revision).toBe(2)
  })

  it('keeps another novel and its derived text untouched', async () => {
    await fixture()
    const otherId = 'novel-text-repair-other'
    await createWorkspaceNovelFromSnapshot({
      novelId: otherId,
      payload: normalizeWorkspaceState({
        localNovels: [{ id: otherId, title: 'Other', summary: '', tags: [] }],
        localChapters: [{ id: 'other-chapter', novelId: otherId, title: 'Other chapter', order: 1, content: html, wordCount: count(legacy), status: 'draft', updatedAt: 'original' }],
      }),
    })
    const other = createNovelDatabaseAccess(otherId)
    other.execute('UPDATE KnowledgeChapter SET rawText = ?', legacy)
    const before = {
      snapshot: readWorkspaceRuntimeSnapshotFromDb(other),
      knowledge: other.queryAll('SELECT * FROM KnowledgeChapter'),
      sync: other.queryAll('SELECT * FROM WorkspaceKnowledgeSyncState'),
    }
    await repairPersistedEntityText(novelId, 1)
    expect({
      snapshot: readWorkspaceRuntimeSnapshotFromDb(other),
      knowledge: other.queryAll('SELECT * FROM KnowledgeChapter'),
      sync: other.queryAll('SELECT * FROM WorkspaceKnowledgeSyncState'),
    }).toEqual(before)
  })

  it('invalidates downstream generated knowledge and retrieval pointers while preserving confirmed facts', async () => {
    const { db } = await fixture()
    for (const [id, status] of [['generated', 'ai_generated'], ['confirmed', 'user_confirmed']]) {
      db.execute(`INSERT INTO KnowledgeFact (id, novelId, branchId, factType, predicate, sourceChapter, validFromChapter, validUntilChapter, status)
        VALUES (?, ?, ?, 'test', 'knows', 2, 2, 999999, ?)`, id, novelId, `${novelId}:main`, status)
    }
    db.execute('INSERT INTO ActiveRetrievalIndex (branchId, tableName) VALUES (?, ?)', `${novelId}:main`, 'old_retrieval')
    db.execute("INSERT INTO PendingRetrievalIndex (branchId, tableName, phase) VALUES (?, ?, 'text')", `${novelId}:main`, 'old_pending')
    await repairPersistedEntityText(novelId, 1)
    expect(db.queryAll('SELECT id, status FROM KnowledgeFact ORDER BY id')).toEqual([
      { id: 'confirmed', status: 'user_confirmed' }, { id: 'generated', status: 'outdated' },
    ])
    expect(db.queryAll('SELECT id, knowledgeStatus FROM KnowledgeChapter ORDER BY id')).toEqual([
      { id: 'chapter-encoded', knowledgeStatus: 'stale' }, { id: 'chapter-literal', knowledgeStatus: 'stale' },
    ])
    expect(db.queryAll('SELECT * FROM ActiveRetrievalIndex')).toEqual([])
    expect(db.queryAll('SELECT * FROM PendingRetrievalIndex')).toEqual([])
  })

  it.each(['queued', 'running', 'paused'])('refuses repairs while a %s job might use the derived artifacts', async (status) => {
    const { raw } = await fixture()
    raw.prepare('INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status) VALUES (?, ?, ?, ?, ?)')
      .run('repair-blocker', novelId, `${novelId}:main`, 'extract_chapter_knowledge', status)
    const before = readState()
    await expect(repairPersistedEntityText(novelId, 1)).rejects.toThrow('active/resumable job')
    expect(readState()).toEqual(before)
  })

  it.each(['revision', 'text', 'claim', 'journal'])('refuses stale or unsynchronized input (%s) without changing data', async (scenario) => {
    const { raw } = await fixture()
    if (scenario === 'revision') raw.exec('UPDATE WorkspaceRuntimeState SET revision = 2')
    if (scenario === 'text') raw.prepare("UPDATE KnowledgeChapter SET rawText = 'different edit' WHERE id = 'chapter-encoded'").run()
    if (scenario === 'claim') raw.exec('UPDATE WorkspaceKnowledgeSyncState SET startedRevision = requestedRevision')
    if (scenario === 'journal') raw.prepare(`INSERT INTO WorkspaceChapterPatchJournal
      (workspaceStateId, committedRevision, chapterId, novelId, contentHtml, wordCount, updatedAtLabel, committedAt)
      VALUES ('singleton', 2, 'chapter-encoded', ?, ?, 1, 'newer', CURRENT_TIMESTAMP)`).run(novelId, html)
    const before = readState()
    await expect(repairPersistedEntityText(novelId, 1)).rejects.toThrow()
    expect(readState()).toEqual(before)
  })

  it('rolls back counts, snapshots, sync state, and raw text together when re-derivation fails', async () => {
    const { raw } = await fixture()
    raw.exec("CREATE TRIGGER reject_repair BEFORE UPDATE ON KnowledgeChapter WHEN NEW.rawText != OLD.rawText BEGIN SELECT RAISE(ABORT, 'injected repair failure'); END")
    const before = readState()
    await expect(repairPersistedEntityText(novelId, 1)).rejects.toThrow('injected repair failure')
    expect(readState()).toEqual(before)
  })

  it('rolls back an already re-derived chapter when completion fails, and can retry', async () => {
    const { raw } = await fixture()
    raw.exec("CREATE TRIGGER reject_repair_completion BEFORE UPDATE ON WorkspaceKnowledgeSyncState WHEN NEW.syncedRevision > OLD.syncedRevision BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END")
    const before = readState()
    await expect(repairPersistedEntityText(novelId, 1)).rejects.toThrow('injected completion failure')
    expect(readState()).toEqual(before)
    raw.exec('DROP TRIGGER reject_repair_completion')
    await expect(repairPersistedEntityText(novelId, 1)).resolves.toMatchObject({ applied: true })
  })

  it('previews read-only and applies through the actual CLI using the preview revision', async () => {
    const { raw } = await fixture()
    raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const file = getNovelStoragePaths(novelId).databasePath
    const digest = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    const before = digest()
    const args = ['scripts/repair-persisted-text.mjs', '--database', file, '--novel-id', novelId]
    const preview = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000, env: process.env })
    expect(preview.status, preview.stderr).toBe(0)
    expect(JSON.parse(preview.stdout)).toMatchObject({ readOnly: true, workspaceRevision: 1, blockers: [] })
    expect(digest()).toBe(before)
    expect(preview.stdout).not.toContain(legacy)
    const apply = spawnSync(process.execPath, [...args, '--apply', '--expected-revision', '1'], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000, env: process.env })
    expect(apply.status, apply.stderr).toBe(0)
    expect(JSON.parse(apply.stdout)).toMatchObject({ applied: true, workspaceRevision: 2 })
    expect(raw.prepare("SELECT rawText FROM KnowledgeChapter WHERE id = 'chapter-encoded'").get()).toEqual({ rawText: decoded })
  }, 60_000)
})
