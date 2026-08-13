import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [action, controlDbPath, novelId, token, now, leaseExpiresAt, novelDirectory, quarantinePath, readyFile, startFile] = process.argv.slice(2)
const database = new DatabaseSync(controlDbPath)
database.exec('PRAGMA busy_timeout = 15000')
fs.writeFileSync(readyFile, action)

while (!fs.existsSync(startFile)) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
}

let changes = 0
let moved = false
database.exec('BEGIN IMMEDIATE')
try {
  if (action === 'publish') {
    changes = Number(database.prepare(
      `UPDATE NovelRegistry
       SET migrationStatus = 'ready', lifecycleToken = NULL, leaseExpiresAt = NULL, claimedAt = NULL, updatedAt = ?
       WHERE novelId = ? AND migrationStatus = 'creating' AND lifecycleToken = ? AND leaseExpiresAt > ?`,
    ).run(now, novelId, token, now).changes)
  } else if (action === 'claim') {
    changes = Number(database.prepare(
      `UPDATE NovelRegistry
       SET migrationStatus = 'deleting', lifecycleToken = ?, leaseExpiresAt = ?, claimedAt = ?, updatedAt = ?
       WHERE novelId = ? AND migrationStatus = 'creating' AND (leaseExpiresAt IS NULL OR leaseExpiresAt <= ?)`,
    ).run(token, leaseExpiresAt, now, now, novelId, now).changes)
  } else {
    throw new Error(`Unsupported lifecycle race action: ${action}`)
  }
  database.exec('COMMIT')
} catch (error) {
  database.exec('ROLLBACK')
  throw error
}

if (action === 'claim' && changes === 1 && fs.existsSync(novelDirectory)) {
  fs.mkdirSync(path.dirname(quarantinePath), { recursive: true })
  fs.renameSync(novelDirectory, quarantinePath)
  moved = true
}

database.close()
process.stdout.write(`${JSON.stringify({ action, changes, moved })}\n`)
