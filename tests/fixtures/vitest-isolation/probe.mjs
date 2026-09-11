import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { sqlite } from '../../../lib/server/sqlite'

// Resolve the lazy singleton during module evaluation, before any test hooks.
const singletonFile = sqlite.prepare('PRAGMA database_list').get().file

export function registerIsolationProbe(name, peer) {
  it(`isolates ${name} while ${peer} writes the same filenames`, async () => {
    const barrier = path.join(process.env.RETALE_TEST_SUITE_ROOT, 'barrier')
    fs.mkdirSync(barrier, { recursive: true })
    fs.mkdirSync(process.env.RETALE_DATA_DIR, { recursive: true })
    const dataFile = path.join(process.env.RETALE_DATA_DIR, 'same.json')
    fs.writeFileSync(dataFile, name)
    sqlite.exec('CREATE TABLE isolation_probe (owner TEXT)')
    sqlite.prepare('INSERT INTO isolation_probe (owner) VALUES (?)').run(name)
    const runtime = {
      testRoot: process.env.RETALE_TEST_ROOT,
      database: singletonFile,
      source: process.env.RETALE_TEST_SOURCE_DB_PATH,
      temp: process.env.TMPDIR,
      evidence: process.env.TASK_EVIDENCE_DIR,
      pid: process.pid,
    }
    fs.writeFileSync(path.join(barrier, `${name}.json`), JSON.stringify(runtime))
    const deadline = Date.now() + 5_000
    while (!fs.existsSync(path.join(barrier, `${peer}.json`)) && Date.now() < deadline) await delay(10)
    expect(fs.existsSync(path.join(barrier, `${peer}.json`))).toBe(true)
    expect(sqlite.prepare('SELECT owner FROM isolation_probe').get().owner).toBe(name)
    expect(fs.readFileSync(dataFile, 'utf8')).toBe(name)
    expect(fs.statSync(runtime.source).size).toBe(0)
    sqlite.close()
  })
}
