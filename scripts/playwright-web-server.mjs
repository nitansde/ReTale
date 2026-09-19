import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  ROOT,
  SAFE_QA_BASE_URL,
  SAFE_QA_EVIDENCE_ROOT,
  SAFE_QA_LIBRARY_URL,
  SAFE_QA_NEXT_DIST_DIR,
  assertPort3000Available,
  assertSafeQaUrls,
  cleanupLegacySafeQaArtifacts,
  createRoleplaySafeDataPath,
  prepareRoleplaySafeDatabaseFile,
  shouldPreserveExistingDatabaseFile,
  writeRoleplaySafeQaManifest,
} from './roleplay-safe-qa.mjs'
import { assertOwnedTestPath, markOwnedTestRoot } from './test-path-safety.mjs'

assertSafeQaUrls()
assertPort3000Available()
markOwnedTestRoot(SAFE_QA_EVIDENCE_ROOT, { repoRoot: ROOT })
cleanupLegacySafeQaArtifacts()

const tempDbPath = process.env.PLAYWRIGHT_TEST_DB_PATH

if (!tempDbPath) {
  throw new Error('[roleplay-safe-qa] Missing PLAYWRIGHT_TEST_DB_PATH for Playwright web server')
}

const preserveExistingDatabase = shouldPreserveExistingDatabaseFile(tempDbPath)
prepareRoleplaySafeDatabaseFile(tempDbPath, { preserveExisting: preserveExistingDatabase })
const tempDataDir = createRoleplaySafeDataPath(tempDbPath)
assertOwnedTestPath(SAFE_QA_EVIDENCE_ROOT, path.resolve(ROOT, SAFE_QA_NEXT_DIST_DIR), {
  repoRoot: ROOT,
  label: 'Playwright Next dist directory',
})

const manifest = writeRoleplaySafeQaManifest({
  dataDir: tempDataDir,
  databaseUrl: `file:${tempDbPath}`,
  databasePath: tempDbPath,
  mode: 'roleplay-safe-playwright',
  sourceDatabase: null,
  testRoot: SAFE_QA_EVIDENCE_ROOT,
  nextDistDir: SAFE_QA_NEXT_DIST_DIR,
  preserveExistingDatabase,
  webServerCommand: 'node scripts/next-test-server.mjs',
})

console.log(`[roleplay-safe-qa] Starting isolated browser QA at ${SAFE_QA_BASE_URL}`)
console.log(`[roleplay-safe-qa] Using dedicated test DB ${manifest.databasePath}`)
console.log(`[roleplay-safe-qa] Preserve existing DB ${preserveExistingDatabase ? 'yes' : 'no'}`)
console.log(`[roleplay-safe-qa] Verifying UI at ${SAFE_QA_LIBRARY_URL}`)
console.log(`[roleplay-safe-qa] Using isolated Next dist dir ${SAFE_QA_NEXT_DIST_DIR}`)

const child = spawn('node', ['scripts/next-test-server.mjs'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    RETALE_INTERNAL_ALLOW_TEST_OVERRIDES: '1',
    RETALE_DATA_DIR: tempDataDir,
    RETALE_SERVER_DATA_DIR: tempDataDir,
    RETALE_SERVER_DIST_DIR: SAFE_QA_NEXT_DIST_DIR,
    RETALE_SERVER_DATABASE_PATH: tempDbPath,
    RETALE_SERVER_DATABASE_URL: `file:${tempDbPath}`,
    RETALE_SERVER_TEST_ROOT: SAFE_QA_EVIDENCE_ROOT,
    RETALE_SERVER_TSCONFIG_PATH: path.join('tests', 'artifacts', 'evidence', 'task-1-test-harness', 'next-test-tsconfig.json'),
  },
})

const stop = (signal = 'SIGTERM') => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', (code) => {
  process.exit(code ?? 0)
})
