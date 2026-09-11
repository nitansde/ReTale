import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { beginSqliteTransaction, getDatabaseTransactionKey } from '@/lib/server/database-transactions'
import { createDatabaseAccess } from '@/lib/server/database-access'
import * as singleton from '@/lib/server/sqlite'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('shared SQLite transaction runner', () => {
  it('serializes singleton callers, rejects unrelated statements, and drains nested rollback failures', async () => {
    singleton.execute('CREATE TABLE IF NOT EXISTS TransactionProbe (value TEXT)')
    singleton.execute('DELETE FROM TransactionProbe')
    const entered = deferred()
    const release = deferred()
    const order: string[] = []
    const first = singleton.withTransaction(async () => {
      singleton.execute("INSERT INTO TransactionProbe VALUES ('rolled-back')")
      entered.resolve()
      await release.promise
      void singleton.withTransaction(async () => {
        await Promise.resolve()
        singleton.execute("INSERT INTO TransactionProbe VALUES ('nested-rollback')")
        throw new Error('nested failure')
      })
      order.push('first')
    })
    const rejection = expect(first).rejects.toThrow('nested failure')
    await entered.promise
    expect(() => singleton.execute("INSERT INTO TransactionProbe VALUES ('unrelated')")).toThrow('another transaction')
    expect(() => singleton.queryOne('SELECT * FROM TransactionProbe')).toThrow('another transaction')
    const second = singleton.withTransaction(() => {
      order.push('second')
      singleton.execute("INSERT INTO TransactionProbe VALUES ('committed')")
    })
    await Promise.resolve()
    expect(order).toEqual([])
    release.resolve()
    await rejection
    await second
    expect(order).toEqual(['first', 'second'])
    expect(singleton.queryAll('SELECT * FROM TransactionProbe')).toEqual([{ value: 'committed' }])
    singleton.execute('DROP TABLE TransactionProbe')
  })

  it('serializes the default database access wrapper and caches each handle identity', async () => {
    const raw = new DatabaseSync(':memory:')
    try {
      raw.exec('CREATE TABLE probe (value INTEGER)')
      const prepare = vi.spyOn(raw, 'prepare')
      expect(getDatabaseTransactionKey(raw)).toBe(getDatabaseTransactionKey(raw))
      expect(prepare.mock.calls.filter(([sql]) => sql === 'PRAGMA database_list')).toHaveLength(1)
      prepare.mockRestore()
      const db = createDatabaseAccess(raw)
      await Promise.all(Array.from({ length: 10 }, (_, index) => db.withTransaction(async () => {
        await Promise.resolve()
        db.execute('INSERT INTO probe VALUES (?)', index)
      })))
      expect(db.queryOne('SELECT COUNT(*) AS count FROM probe')).toEqual({ count: 10 })
    } finally { raw.close() }
  })

  it('allows timers and a WAL reader to progress while another process holds a writer lock', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-sqlite-contention-'))
    const file = path.join(directory, 'probe.db')
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE probe (value INTEGER)')
    const reader = new DatabaseSync(file)
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      console.log('locked');
      setTimeout(() => { db.exec('ROLLBACK'); db.close() }, 500);
    `, file], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    try {
      await once(child.stdout!, 'data')
      let acquired = false
      let timerRanWhileWaiting = false
      const start = performance.now()
      const timer = new Promise<void>((resolve) => setTimeout(() => {
        timerRanWhileWaiting = !acquired
        expect(reader.prepare('SELECT COUNT(*) AS count FROM probe').get()).toEqual({ count: 0 })
        resolve()
      }, 10))
      let callbacks = 0
      await createDatabaseAccess(raw).withTransaction(() => {
        callbacks += 1
        acquired = true
        raw.exec('INSERT INTO probe VALUES (1)')
      })
      await timer
      expect(timerRanWhileWaiting).toBe(true)
      expect(callbacks).toBe(1)
      expect(performance.now() - start).toBeGreaterThan(200)
      expect(raw.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 2000 })
      expect(reader.prepare('SELECT COUNT(*) AS count FROM probe').get()).toEqual({ count: 1 })
    } finally {
      child.kill()
      await exited
      reader.close()
      raw.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('restores the busy timeout and releases the queue after acquisition times out', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-sqlite-timeout-'))
    const file = path.join(directory, 'probe.db')
    const raw = new DatabaseSync(file)
    const blocker = new DatabaseSync(file)
    try {
      raw.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30; CREATE TABLE probe (value INTEGER)')
      blocker.exec('BEGIN IMMEDIATE')
      const callback = vi.fn()
      await expect(createDatabaseAccess(raw).withTransaction(callback)).rejects.toThrow('locked')
      expect(callback).not.toHaveBeenCalled()
      expect(raw.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 30 })
      blocker.exec('ROLLBACK')
      await expect(createDatabaseAccess(raw).withTransaction(callback)).resolves.toBeUndefined()
      expect(callback).toHaveBeenCalledTimes(1)
      raw.exec('BEGIN IMMEDIATE')
      await expect(beginSqliteTransaction(raw)).rejects.toThrow('within a transaction')
      raw.exec('ROLLBACK')
    } finally {
      blocker.close()
      raw.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
