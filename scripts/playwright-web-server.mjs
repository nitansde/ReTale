import { spawn } from 'node:child_process'
import {
  ROOT,
  SAFE_QA_BASE_URL,
  SAFE_QA_HOST,
  SAFE_QA_LIBRARY_URL,
  SAFE_QA_NEXT_DIST_DIR,
  SAFE_QA_PORT,
  assertPort3000Available,
  assertSafeQaUrls,
  cleanupLegacySafeQaArtifacts,
  prepareRoleplaySafeDatabaseFile,
  shouldPreserveExistingDatabaseFile,
  writeRoleplaySafeQaManifest,
} from './roleplay-safe-qa.mjs'

assertSafeQaUrls()
assertPort3000Available()
cleanupLegacySafeQaArtifacts()

const tempDbPath = process.env.PLAYWRIGHT_TEST_DB_PATH

if (!tempDbPath) {
  throw new Error('[roleplay-safe-qa] Missing PLAYWRIGHT_TEST_DB_PATH for Playwright web server')
}

const preserveExistingDatabase = shouldPreserveExistingDatabaseFile(tempDbPath)
prepareRoleplaySafeDatabaseFile(tempDbPath, { preserveExisting: preserveExistingDatabase })

const manifest = writeRoleplaySafeQaManifest({
  databaseUrl: `file:${tempDbPath}`,
  databasePath: tempDbPath,
  mode: 'roleplay-safe-playwright',
  sourceDatabase: null,
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
    RETALE_SERVER_DIST_DIR: SAFE_QA_NEXT_DIST_DIR,
    RETALE_SERVER_DATABASE_PATH: tempDbPath,
    RETALE_SERVER_DATABASE_URL: `file:${tempDbPath}`,
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
