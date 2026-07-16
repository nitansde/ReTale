import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  ROOT,
  SAFE_QA_BASE_URL,
  SAFE_QA_EVIDENCE_ROOT,
  SAFE_QA_HOST,
  SAFE_QA_LIBRARY_URL,
  SAFE_QA_MANIFEST_PATH,
  SAFE_QA_PORT,
  SAFE_QA_UI_EVIDENCE_DIR,
  assertPort3000Available,
  assertSafeQaUrls,
  cleanupLegacySafeQaArtifacts,
  createRoleplaySafeDatabasePath,
  createRoleplaySafeDataPath,
  writeRoleplaySafeQaManifest,
} from './roleplay-safe-qa.mjs'
import { assertOwnedTestPath, markOwnedTestRoot } from './test-path-safety.mjs'

const selector = process.argv[2] ?? ''

assertSafeQaUrls()
markOwnedTestRoot(SAFE_QA_EVIDENCE_ROOT, { repoRoot: ROOT })
fs.mkdirSync(SAFE_QA_UI_EVIDENCE_DIR, { recursive: true })
cleanupLegacySafeQaArtifacts()
assertPort3000Available()

const testDbPath = process.env.PLAYWRIGHT_TEST_DB_PATH ?? createRoleplaySafeDatabasePath()
assertOwnedTestPath(SAFE_QA_EVIDENCE_ROOT, testDbPath, {
  repoRoot: ROOT,
  label: 'Playwright database',
})
const testDataDir = createRoleplaySafeDataPath(testDbPath)
const manifest = writeRoleplaySafeQaManifest({
  baseUrl: SAFE_QA_BASE_URL,
  dataDir: testDataDir,
  databasePath: testDbPath,
  databaseUrl: `file:${testDbPath}`,
  grep: selector || null,
  mode: 'roleplay-safe-playwright',
  playwrightConfig: 'playwright.config.mjs',
  sourceDatabase: null,
  testRoot: SAFE_QA_EVIDENCE_ROOT,
})

console.log(`[roleplay-safe-qa] Running browser suite against ${SAFE_QA_HOST}:${SAFE_QA_PORT}`)
console.log(`[roleplay-safe-qa] Base URL ${SAFE_QA_BASE_URL}`)
console.log(`[roleplay-safe-qa] Health URL ${SAFE_QA_LIBRARY_URL}`)
console.log(`[roleplay-safe-qa] Dedicated test DB ${manifest.databasePath}`)
console.log(`[roleplay-safe-qa] Evidence manifest ${SAFE_QA_MANIFEST_PATH}`)

const args = ['playwright', 'test', '--config', 'playwright.config.mjs']
if (selector) {
  args.push('--grep', selector)
}

const result = spawnSync('npx', args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_TEST_DB_PATH: testDbPath,
    TASK_EVIDENCE_DIR: SAFE_QA_EVIDENCE_ROOT,
  },
})

process.exit(result.status ?? 1)
