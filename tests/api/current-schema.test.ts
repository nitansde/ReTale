import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { assertCurrentDatabaseSchema, DatabaseSchemaVersionError, initializeDatabase, readDatabaseSchemaVersion, DATABASE_APPLICATION_IDS } from '@/lib/server/sqlite'
import { createDatabaseAccess, queryOne, runWithDatabaseAccessScope } from '@/lib/server/database-access'

const connections: DatabaseSync[] = []
const dirs: string[] = []
const open = () => { const db = new DatabaseSync(':memory:'); connections.push(db); return db }
afterEach(() => { for (const db of connections.splice(0)) db.close(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('strict current database contract', () => {
  it.each(['full', 'control'] as const)('creates the complete %s schema with explicit version and kind', kind => {
    const db = initializeDatabase(open(), { mode: kind })
    expect(readDatabaseSchemaVersion(db)).toEqual({ version: 3, applicationId: DATABASE_APPLICATION_IDS[kind] })
    expect(() => assertCurrentDatabaseSchema(db, kind)).not.toThrow()
    expect(() => initializeDatabase(db, { mode: kind })).not.toThrow()
  })
  it.each([0, 1, 2, 4])('rejects version %s without changing the database file', version => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-schema-')); dirs.push(dir)
    const filename = path.join(dir, 'db.sqlite')
    const db = new DatabaseSync(filename)
    db.exec(`CREATE TABLE OldData (value TEXT); INSERT INTO OldData VALUES ('keep'); PRAGMA user_version = ${version}`)
    db.close()
    const before = fs.readFileSync(filename)
    const opened = new DatabaseSync(filename)
    try { expect(() => initializeDatabase(opened)).toThrow(DatabaseSchemaVersionError) } finally { opened.close() }
    expect(fs.readFileSync(filename)).toEqual(before)
    expect(fs.readdirSync(dir)).toEqual(['db.sqlite'])
  })
  it('rejects a wrong kind and a missing required schema object', () => {
    const db = initializeDatabase(open())
    expect(() => initializeDatabase(db, { mode: 'control' })).toThrow(/kind/)
    db.exec('DROP INDEX idx_character_candidates_promotion_lookup')
    expect(() => initializeDatabase(db)).toThrow(/missing or changed index/)
  })
  it('rejects altered table definitions even when the version is current', () => {
    const db = initializeDatabase(open())
    db.exec('ALTER TABLE WorkspaceState ADD COLUMN obsolete TEXT')
    expect(() => initializeDatabase(db)).toThrow(/changed table WorkspaceState/)
  })
})

describe('explicit database scope', () => {
  it('never consults DATABASE_URL or a global connection when scope is missing', () => {
    const previousUrl = process.env.DATABASE_URL
    const host = globalThis as typeof globalThis & { sqlite?: DatabaseSync }
    const previous = host.sqlite
    host.sqlite = initializeDatabase(open())
    process.env.DATABASE_URL = 'file:/must-not-open-this.db'
    try { expect(() => queryOne('SELECT 1')).toThrow(/explicit database scope/) }
    finally { if (previous) host.sqlite = previous; else delete host.sqlite; if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl }
  })
  it('isolates concurrent scopes, restores nested scope, and clears failed scope', async () => {
    const a = createDatabaseAccess(initializeDatabase(open()))
    const b = createDatabaseAccess(initializeDatabase(open()))
    a.execute("INSERT INTO AppSetting(id,key,value) VALUES ('a','identity','a')")
    b.execute("INSERT INTO AppSetting(id,key,value) VALUES ('b','identity','b')")
    const read = () => queryOne<{value: string}>("SELECT value FROM AppSetting WHERE key='identity'")!.value
    const results = await Promise.all([a, b].map(db => runWithDatabaseAccessScope(db, async () => { await Promise.resolve(); return read() })))
    expect(results).toEqual(['a', 'b'])
    await runWithDatabaseAccessScope(a, async () => {
      expect(read()).toBe('a')
      await expect(runWithDatabaseAccessScope(b, async () => { expect(read()).toBe('b'); throw new Error('failure') })).rejects.toThrow('failure')
      expect(read()).toBe('a')
    })
    expect(() => read()).toThrow(/explicit database scope/)
  })
})
