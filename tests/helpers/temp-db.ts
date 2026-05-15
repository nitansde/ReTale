import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const SOURCE_DB_PATH = path.join(ROOT, 'dev.db')

export function getSourceDbPath() {
  return SOURCE_DB_PATH
}

export function hashFile(filePath: string) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

export function createTempDatabaseCopy(prefix: string) {
  if (!fs.existsSync(SOURCE_DB_PATH)) {
    throw new Error(`Missing source database: ${SOURCE_DB_PATH}`)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const dbPath = path.join(tempDir, 'test.db')
  fs.copyFileSync(SOURCE_DB_PATH, dbPath)

  return {
    directory: tempDir,
    dbPath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true })
    },
  }
}
