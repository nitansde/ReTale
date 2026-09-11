import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

describe('storage maintenance preview CLI', () => {
  it('reports derived text and retention candidates without changing the database', () => {
    const fixture = createTempDatabaseCopy('storage-preview')
    try {
      const database = initializeDatabase(new DatabaseSync(fixture.dbPath))
      database.exec(`
        INSERT INTO NovelRecord (id, title) VALUES ('preview', 'Preview');
        INSERT INTO StoryBranch (id, novelId, name) VALUES ('preview:main', 'preview', 'main');
        INSERT INTO WorkspaceState (id, payload) VALUES ('singleton', '{}');
        INSERT INTO WorkspaceStateBackup (id, workspaceStateId, payload) VALUES ('old', 'singleton', 'old'), ('new', 'singleton', 'new');
        INSERT INTO WorkspaceRuntimeState (id) VALUES ('singleton');
        INSERT INTO WorkspaceRuntimeChapter (id, novelId, title, contentHtml, wordCount)
          VALUES ('chapter', 'preview', 'Chapter', '<p>A &amp; B</p>', 7);
        INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, rawText, sourceHash)
          VALUES ('chapter', 'preview', 'preview:main', 1, 'A &amp; B', 'old-hash');
        INSERT INTO RawTextEmbeddingCache (branchId, provider, model, embeddingInputHash, vectorBlob, vectorDimension, lastSeenAt)
          VALUES ('preview:main', 'ollama', 'old-model', 'hash', X'cdcccc3d', 1, '2026-01-01');
      `)
      database.close()
      const before = createHash('sha256').update(fs.readFileSync(fixture.dbPath)).digest('hex')
      const report = JSON.parse(execFileSync(process.execPath, [
        '--experimental-strip-types', 'scripts/preview-storage-maintenance.mjs', '--database', fixture.dbPath,
        '--protect-model', 'ollama=current-model',
      ], {
        encoding: 'utf8', env: { ...process.env, RETALE_BACKUP_MAX_COUNT: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }))
      expect(report.readOnly).toBe(true)
      expect(report.disk.physicalBytesReclaimedByThisPreview).toBe(0)
      expect(report.backups[0]).toMatchObject({ totalCount: 2, retainedCount: 1 })
      expect(report.caches[0]).toMatchObject({ eligibleRows: 1 })
      expect(report.derivedText).toMatchObject({
        chapterCount: 1,
        affected: [{ chapterId: 'chapter', rawTextMismatch: true, storedWordCount: 7, derivedWordCount: 3, hasEncodedEntities: true }],
      })
      expect(createHash('sha256').update(fs.readFileSync(fixture.dbPath)).digest('hex')).toBe(before)
      const conservative = JSON.parse(execFileSync(process.execPath, [
        '--experimental-strip-types', 'scripts/preview-storage-maintenance.mjs', '--database', fixture.dbPath,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
      expect(conservative.caches[0].eligibleRows).toBe(0)
      expect(conservative.cacheIdentityProtection).toBe('all-identities-no-current-model-supplied')
    } finally {
      fixture.cleanup()
    }
  })
})
