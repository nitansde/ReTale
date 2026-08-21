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
  database.prepare('INSERT INTO WorkspaceRuntimeState (id) VALUES (?)').run('singleton')
  database.prepare(
    `INSERT INTO WorkspaceKnowledgeSyncState (
       workspaceStateId, requestedRevision, syncedRevision, requestedSourceUpdatedAt
     ) VALUES (?, ?, ?, ?)`,
  ).run('singleton', 2, 0, 'source-2')
  return { database, db: createDatabaseAccess(database, { novelId: directory }) }
}

afterEach(() => {
  while (createdDirectories.length) {
    fs.rmSync(createdDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('workspace knowledge sync claim ownership', () => {
  it('fences stale completion and failure after a newer worker reclaims the same revision', async () => {
    const { database, db } = createFixture()
    const claimA = await claimPendingWorkspaceKnowledgeSync('singleton', { db })
    expect(claimA).not.toBeNull()
    database.prepare(
      `UPDATE WorkspaceKnowledgeSyncState SET startedAt = datetime('now', '-10 minutes') WHERE workspaceStateId = ?`,
    ).run('singleton')

    const claimB = await claimPendingWorkspaceKnowledgeSync('singleton', { db })
    expect(claimB).not.toBeNull()
    expect(claimB?.claimToken).not.toBe(claimA?.claimToken)
    expect(await completeWorkspaceKnowledgeSync(claimA!, { db })).toBe(false)
    expect(await failWorkspaceKnowledgeSync(claimA!, 'late stale failure', { db })).toBe(false)
    expect(database.prepare(
      `SELECT startedRevision, claimToken, lastError FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?`,
    ).get('singleton')).toEqual({
      startedRevision: 2,
      claimToken: claimB?.claimToken,
      lastError: null,
    })

    expect(await completeWorkspaceKnowledgeSync(claimB!, { db })).toBe(true)
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

  it('never regresses an already advanced synced revision or its source timestamp', async () => {
    const { database, db } = createFixture()
    const claim = await claimPendingWorkspaceKnowledgeSync('singleton', { db })
    expect(claim).not.toBeNull()
    database.prepare(
      `UPDATE WorkspaceKnowledgeSyncState
       SET syncedRevision = ?, syncedSourceUpdatedAt = ?
       WHERE workspaceStateId = ?`,
    ).run(7, 'source-7', 'singleton')

    expect(await completeWorkspaceKnowledgeSync(claim!, { db })).toBe(true)
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

  it('queues claim and completion behind foreground novel transactions', async () => {
    const { database, db } = createFixture()
    const foregroundEntered = Promise.withResolvers<void>()
    const releaseForeground = Promise.withResolvers<void>()
    let claimSettled = false

    const foreground = db.withTransaction(async () => {
      database.prepare('UPDATE WorkspaceRuntimeState SET promptText = ? WHERE id = ?').run('knowledge', 'singleton')
      foregroundEntered.resolve()
      await releaseForeground.promise
    })
    await foregroundEntered.promise

    const claimPromise = claimPendingWorkspaceKnowledgeSync('singleton', { db }).finally(() => {
      claimSettled = true
    })
    await Promise.resolve()
    expect(claimSettled).toBe(false)
    releaseForeground.resolve()
    await foreground

    const claim = await claimPromise
    expect(claim).not.toBeNull()

    const rollbackEntered = Promise.withResolvers<void>()
    const releaseRollback = Promise.withResolvers<void>()
    let completionSettled = false
    const rollback = db.withTransaction(async () => {
      database.prepare('UPDATE WorkspaceRuntimeState SET promptText = ? WHERE id = ?').run('timeline', 'singleton')
      rollbackEntered.resolve()
      await releaseRollback.promise
      throw new Error('foreground rollback')
    })
    void rollback.catch(() => undefined)
    await rollbackEntered.promise

    const completion = completeWorkspaceKnowledgeSync(claim!, { db }).finally(() => {
      completionSettled = true
    })
    await Promise.resolve()
    expect(completionSettled).toBe(false)
    releaseRollback.resolve()
    await expect(rollback).rejects.toThrow('foreground rollback')
    await expect(completion).resolves.toBe(true)
    expect(database.prepare('SELECT promptText FROM WorkspaceRuntimeState WHERE id = ?').get('singleton')).toEqual({
      promptText: 'knowledge',
    })
    expect(database.prepare(
      'SELECT syncedRevision, startedRevision, claimToken FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?',
    ).get('singleton')).toEqual({ syncedRevision: 2, startedRevision: null, claimToken: null })
    database.close()
  })
})
