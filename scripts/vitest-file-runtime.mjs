import fs from 'node:fs'
import path from 'node:path'
import { assertOwnedTestPath, createOwnedTestRoot } from './test-path-safety.mjs'

export function resolveTestWorkers(value = process.env.RETALE_TEST_WORKERS) {
  if (value === undefined || value === '') return 2
  if (!/^[1-8]$/u.test(value)) throw new Error('RETALE_TEST_WORKERS must be an integer from 1 to 8')
  return Number(value)
}

/** @param {{ suiteRoot: string, testFile: string, repoRoot?: string }} options */
export function createVitestFileRuntime({ suiteRoot, testFile, repoRoot = process.cwd() }) {
  // Validate the suite marker and containment before creating any child paths.
  const filesRoot = assertOwnedTestPath(suiteRoot, path.join(suiteRoot, 'files'), { repoRoot })
  const prefix = path.basename(testFile).replace(/[^a-zA-Z0-9.-]/gu, '_') + '-'
  const testRoot = createOwnedTestRoot(filesRoot, prefix, { repoRoot })
  const sourceDbPath = path.join(testRoot, 'source.db')
  const tempDir = path.join(testRoot, 'tmp')
  const evidenceDir = path.join(testRoot, 'evidence')
  fs.closeSync(fs.openSync(sourceDbPath, 'wx'))
  fs.mkdirSync(tempDir)
  fs.mkdirSync(evidenceDir)
  fs.writeFileSync(path.join(testRoot, 'test-file.json'), JSON.stringify({ testFile, pid: process.pid }) + '\n')
  return {
    RETALE_TEST_ROOT: testRoot,
    RETALE_TEST_SOURCE_DB_PATH: sourceDbPath,
    DATABASE_URL: `file:${path.join(testRoot, 'runtime.db')}`,
    RETALE_DATA_DIR: path.join(testRoot, 'data'),
    LANCEDB_DIR: path.join(testRoot, 'lancedb'),
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    TASK_EVIDENCE_DIR: evidenceDir,
  }
}
