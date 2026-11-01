import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { updateKnowledgeJobRow } from '@/lib/server/knowledge-job-update'
import type { SqlParam } from '@/lib/server/database-access'

describe('updateKnowledgeJobRow', () => {
  let database: DatabaseSync
  const db = {
    execute: (sql: string, ...params: SqlParam[]) => database.prepare(sql).run(...params),
  }
  const statusOf = () => (database.prepare("SELECT status FROM KnowledgeJob WHERE id = 'job'").get() as { status: string }).status

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec(`CREATE TABLE KnowledgeJob (
      id TEXT PRIMARY KEY, jobType TEXT, status TEXT, progress REAL, currentStep TEXT,
      payloadJson TEXT, errorMessage TEXT, updatedAt TEXT
    )`)
    database.prepare(`INSERT INTO KnowledgeJob VALUES ('job', 'rewrite', 'running', 0.5, 'step', ?, NULL, 'then')`)
      .run(JSON.stringify({ taskWatchdog: { attemptId: 'current' } }))
  })

  it('writes the given fields and skips undefined ones', () => {
    expect(updateKnowledgeJobRow(db, 'job', { status: 'failed', currentStep: undefined, errorMessage: null }).changes).toBe(1)
    const row = database.prepare("SELECT status, currentStep, errorMessage, updatedAt FROM KnowledgeJob WHERE id = 'job'").get() as Record<string, unknown>
    expect(row).toMatchObject({ status: 'failed', currentStep: 'step', errorMessage: null })
    expect(row.updatedAt).not.toBe('then')
  })

  it.each([
    ['a stale attempt', { attemptId: 'retired' }],
    ['another job type', { jobType: 'extract' }],
    ['a settled status', { statuses: ['queued', 'paused'] }],
    ['a stale updatedAt', { updatedAt: 'earlier' }],
  ])('leaves the row alone for %s', (_label, guard) => {
    expect(updateKnowledgeJobRow(db, 'job', { status: 'aborted' }, guard).changes).toBe(0)
    expect(statusOf()).toBe('running')
  })

  it('updates when every guard matches', () => {
    const guard = { attemptId: 'current', jobType: 'rewrite', statuses: ['running'], updatedAt: 'then' }
    expect(updateKnowledgeJobRow(db, 'job', { status: 'aborted' }, guard).changes).toBe(1)
    expect(statusOf()).toBe('aborted')
  })
})
