import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import {
  assertOwnedTestPath,
  markOwnedTestRoot,
  removeOwnedTestTreeIfMarked,
} from './test-path-safety.mjs'

export const ROOT = process.cwd()
export const SAFE_QA_HOST = '127.0.0.1'
export const SAFE_QA_PORT = 3000
export const SAFE_QA_BASE_URL = `http://${SAFE_QA_HOST}:${SAFE_QA_PORT}`
export const SAFE_QA_LIBRARY_URL = `${SAFE_QA_BASE_URL}/library`
export const SAFE_QA_EVIDENCE_ROOT = path.join(ROOT, 'tests/artifacts/evidence/task-1-test-harness')
export const SAFE_QA_UI_EVIDENCE_DIR = path.join(SAFE_QA_EVIDENCE_ROOT, 'ui')
export const SAFE_QA_DB_DIR = path.join(SAFE_QA_EVIDENCE_ROOT, 'roleplay-safe-db')
export const SAFE_QA_DATA_DIR = path.join(SAFE_QA_EVIDENCE_ROOT, 'roleplay-safe-data')
export const SAFE_QA_NEXT_DIST_DIR = path.join('tests', 'artifacts', 'evidence', 'task-1-test-harness', 'next-playwright-safe')
export const SAFE_QA_LEGACY_NEXT_DIST_PATH = path.join(ROOT, '.next-playwright-safe')
export const SAFE_QA_MANIFEST_PATH = path.join(SAFE_QA_UI_EVIDENCE_DIR, 'roleplay-safe-qa.json')

function assertDoesNotTargetUnsafePort(value, label) {
  if (String(value).includes('14500')) {
    throw new Error(`[roleplay-safe-qa] ${label} must never target port 14500: ${value}`)
  }
}

export function assertSafeQaUrls() {
  assertDoesNotTargetUnsafePort(SAFE_QA_BASE_URL, 'base URL')
  assertDoesNotTargetUnsafePort(SAFE_QA_LIBRARY_URL, 'library URL')
}

export function assertPort3000Available() {
  try {
    const output = execSync(`lsof -ti tcp:${SAFE_QA_PORT} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()

    if (!output) {
      return
    }

    const pids = output.split(/\s+/).filter(Boolean)
    throw new Error(
      `[roleplay-safe-qa] Refusing to start because ${SAFE_QA_HOST}:${SAFE_QA_PORT} is already in use by PID(s): ${pids.join(', ')}. `
      + 'Safe QA will not kill unknown port-3000 listeners.'
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[roleplay-safe-qa]')) {
      throw error
    }
  }
}

export function createRoleplaySafeDatabasePath() {
  markOwnedTestRoot(SAFE_QA_EVIDENCE_ROOT, { repoRoot: ROOT })
  fs.mkdirSync(SAFE_QA_DB_DIR, { recursive: true })
  const dbPath = path.join(SAFE_QA_DB_DIR, `playwright-${Date.now()}-${process.pid}.sqlite`)
  assertDoesNotTargetUnsafePort(dbPath, 'database path')
  return assertOwnedTestPath(SAFE_QA_EVIDENCE_ROOT, dbPath, {
    repoRoot: ROOT,
    label: 'Playwright database',
  })
}

export function createRoleplaySafeDataPath(dbPath) {
  const resolvedDbPath = assertOwnedTestPath(SAFE_QA_EVIDENCE_ROOT, dbPath, {
    repoRoot: ROOT,
    label: 'Playwright database',
  })
  const databaseName = path.basename(resolvedDbPath, path.extname(resolvedDbPath))
  return assertOwnedTestPath(SAFE_QA_EVIDENCE_ROOT, path.join(SAFE_QA_DATA_DIR, databaseName), {
    repoRoot: ROOT,
    label: 'Playwright data directory',
  })
}

export function shouldPreserveExistingDatabaseFile(dbPath) {
  assertDoesNotTargetUnsafePort(dbPath, 'database path')
  assertOwnedTestPath(SAFE_QA_EVIDENCE_ROOT, dbPath, {
    repoRoot: ROOT,
    label: 'Playwright database',
  })
  return fs.existsSync(dbPath)
}

export function prepareRoleplaySafeDatabaseFile(dbPath, options = {}) {
  assertDoesNotTargetUnsafePort(dbPath, 'database path')
  assertOwnedTestPath(SAFE_QA_EVIDENCE_ROOT, dbPath, {
    repoRoot: ROOT,
    label: 'Playwright database',
  })
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  if (options.preserveExisting && fs.existsSync(dbPath)) {
    return
  }
  fs.rmSync(dbPath, { force: true })
}

export function cleanupLegacySafeQaArtifacts() {
  removeOwnedTestTreeIfMarked(SAFE_QA_LEGACY_NEXT_DIST_PATH, ROOT, {
    repoRoot: ROOT,
    label: 'legacy Playwright dist directory',
  })
}

export function writeRoleplaySafeQaManifest(fields) {
  markOwnedTestRoot(SAFE_QA_EVIDENCE_ROOT, { repoRoot: ROOT })
  fs.mkdirSync(SAFE_QA_UI_EVIDENCE_DIR, { recursive: true })
  const manifest = {
    host: SAFE_QA_HOST,
    port: SAFE_QA_PORT,
    baseUrl: SAFE_QA_BASE_URL,
    libraryUrl: SAFE_QA_LIBRARY_URL,
    nextDistDir: SAFE_QA_NEXT_DIST_DIR,
    ...fields,
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  fs.writeFileSync(SAFE_QA_MANIFEST_PATH, serialized)
  return manifest
}
