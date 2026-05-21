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
  writeRoleplaySafeQaManifest,
} from './roleplay-safe-qa.mjs'

assertSafeQaUrls()
assertPort3000Available()
cleanupLegacySafeQaArtifacts()

const tempDbPath = process.env.PLAYWRIGHT_TEST_DB_PATH

if (!tempDbPath) {
  throw new Error('[roleplay-safe-qa] Missing PLAYWRIGHT_TEST_DB_PATH for Playwright web server')
}

prepareRoleplaySafeDatabaseFile(tempDbPath)

const manifest = writeRoleplaySafeQaManifest({
  databaseUrl: `file:${tempDbPath}`,
  databasePath: tempDbPath,
  mode: 'roleplay-safe-playwright',
  sourceDatabase: null,
  nextDistDir: SAFE_QA_NEXT_DIST_DIR,
  webServerCommand: `npm run dev -- --hostname ${SAFE_QA_HOST} --port ${SAFE_QA_PORT}`,
})

console.log(`[roleplay-safe-qa] Starting isolated browser QA at ${SAFE_QA_BASE_URL}`)
console.log(`[roleplay-safe-qa] Using dedicated test DB ${manifest.databasePath}`)
console.log(`[roleplay-safe-qa] Verifying UI at ${SAFE_QA_LIBRARY_URL}`)
console.log(`[roleplay-safe-qa] Using isolated Next dist dir ${SAFE_QA_NEXT_DIST_DIR}`)

const child = spawn('npm', ['run', 'dev', '--', '--hostname', SAFE_QA_HOST, '--port', String(SAFE_QA_PORT)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    CHATBOOK_NEXT_DIST_DIR: SAFE_QA_NEXT_DIST_DIR,
    DATABASE_URL: `file:${tempDbPath}`,
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
