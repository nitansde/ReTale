import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabaseAccess } from '@/lib/server/database-access'
import {
  claimPendingWorkspaceKnowledgeSync,
  completeWorkspaceKnowledgeSync,
  failWorkspaceKnowledgeSync,
} from '@/lib/server/persistence'
import { initializeDatabase } from '@/lib/server/sqlite'

const createdDirectories: string[] = []

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-workspace-sync-claim-'))
  createdDirectories.push(directory)
  const database = initializeDatabase(new DatabaseSync(path.join(directory, 'novel.db')))
  database.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', '{}')
  database.prepare(
    `INSERT INTO WorkspaceKnowledgeSyncState (
       workspaceStateId, requestedRevision, syncedRevision, requestedSourceUpdatedAt
     ) VALUES (?, ?, ?, ?)`,
  ).run('singleton', 2, 0, 'source-2')
  return { database, db: createDatabaseAccess(database) }
}

afterEach(() => {
  while (createdDirectories.length) {
    fs.rmSync(createdDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('workspace knowledge sync claim ownership', () => {
  it('fences stale completion and failure after a newer worker reclaims the same revision', () => {
    const { database, db } = createFixture()
    const claimA = claimPendingWorkspaceKnowledgeSync('singleton', { db })
    expect(claimA).not.toBeNull()
    database.prepare(
      `UPDATE WorkspaceKnowledgeSyncState SET startedAt = datetime('now', '-10 minutes') WHERE workspaceStateId = ?`,
    ).run('singleton')

    const claimB = claimPendingWorkspaceKnowledgeSync('singleton', { db })
    expect(claimB).not.toBeNull()
    expect(claimB?.claimToken).not.toBe(claimA?.claimToken)
    expect(completeWorkspaceKnowledgeSync(claimA!, { db })).toBe(false)
    expect(failWorkspaceKnowledgeSync(claimA!, 'late stale failure', { db })).toBe(false)
    expect(database.prepare(
      `SELECT startedRevision, claimToken, lastError FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?`,
    ).get('singleton')).toEqual({
      startedRevision: 2,
      claimToken: claimB?.claimToken,
      lastError: null,
    })

    expect(completeWorkspaceKnowledgeSync(claimB!, { db })).toBe(true)
    expect(database.prepare(
      `SELECT syncedRevision, syncedSourceUpdatedAt, startedRevision, claimToken, lastError
       FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?`,
    ).get('singleton')).toEqual({
      syncedRevision: 2,
      syncedSourceUpdatedAt: 'source-2',
      startedRevision: null,
      claimToken: null,
      lastError: null,
    })
    database.close()
  })

  it('never regresses an already advanced synced revision or its source timestamp', () => {
    const { database, db } = createFixture()
    const claim = claimPendingWorkspaceKnowledgeSync('singleton', { db })
    expect(claim).not.toBeNull()
    database.prepare(
      `UPDATE WorkspaceKnowledgeSyncState
       SET syncedRevision = ?, syncedSourceUpdatedAt = ?
       WHERE workspaceStateId = ?`,
    ).run(7, 'source-7', 'singleton')

    expect(completeWorkspaceKnowledgeSync(claim!, { db })).toBe(true)
    expect(database.prepare(
      `SELECT syncedRevision, syncedSourceUpdatedAt, startedRevision, claimToken
       FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?`,
    ).get('singleton')).toEqual({
      syncedRevision: 7,
      syncedSourceUpdatedAt: 'source-7',
      startedRevision: null,
      claimToken: null,
    })
    database.close()
  })
})
