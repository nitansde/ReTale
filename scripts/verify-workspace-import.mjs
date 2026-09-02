import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { assertPortAvailable, assertPortReleased } from './production-port-safety.mjs'
import {
  assertOwnedTestPath,
  createOwnedTestRoot,
  removeOwnedTestTree,
} from './test-path-safety.mjs'

const ROOT = process.cwd()
const FIXTURE_PATH = path.join(ROOT, 'scripts/fixtures/workspace-import-smoke.txt')
const RUNS_ROOT = path.join(ROOT, '.sisyphus', 'runtime')
const PORT = 3000
const HOST = '127.0.0.1'
const SERVER_URL = `http://${HOST}:${PORT}`
const EXPECTED_CHAPTER_COUNT = 3
const PATCH_CONTENT = '<p>Workspace import revision two verified.</p>'
const PATCH_VISIBLE_TEXT = 'Workspace import revision two verified.'
const PATCH_WORD_COUNT = 5
const PATCH_UPDATED_AT_LABEL = 'Revision 2 integration check'
const PATCH_IDEMPOTENCY_KEY = 'verify-workspace-import-revision-1-to-2'

function assertRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a nonempty string`)
  }
  return value
}

function readHeader(headers, name) {
  if (typeof headers.get === 'function') return headers.get(name)
  const matchingName = Object.keys(headers).find((headerName) => headerName.toLowerCase() === name.toLowerCase())
  return matchingName ? headers[matchingName] : null
}

function assertRevisionHeaders(headers, revision, novelId, label) {
  assertEqual(readHeader(headers, 'x-retale-workspace-revision'), String(revision), `${label} revision header`)
  assertEqual(readHeader(headers, 'x-retale-revision-novel-id'), novelId, `${label} revision owner header`)
}

function createRuntimeConfig() {
  const testRoot = createOwnedTestRoot(RUNS_ROOT, 'retale-workspace-import-', { repoRoot: ROOT })
  const databasePath = assertOwnedTestPath(testRoot, path.join(testRoot, 'verify.db'), {
    repoRoot: ROOT,
    label: 'workspace import database',
  })
  const dataDir = assertOwnedTestPath(testRoot, path.join(testRoot, 'data'), {
    repoRoot: ROOT,
    label: 'workspace import data directory',
  })
  const distPath = assertOwnedTestPath(testRoot, path.join(testRoot, 'next-dist'), {
    repoRoot: ROOT,
    label: 'workspace import Next dist directory',
  })
  const tsconfigPath = assertOwnedTestPath(testRoot, path.join(testRoot, 'tsconfig.json'), {
    repoRoot: ROOT,
    label: 'workspace import Next tsconfig',
  })
  const distDir = path.relative(ROOT, distPath)
  const relativeTsconfigPath = path.relative(ROOT, tsconfigPath)

  assertOwnedTestPath(testRoot, path.resolve(ROOT, distDir), {
    repoRoot: ROOT,
    label: 'resolved workspace import Next dist directory',
  })
  assertOwnedTestPath(testRoot, path.resolve(ROOT, relativeTsconfigPath), {
    repoRoot: ROOT,
    label: 'resolved workspace import Next tsconfig',
  })

  return {
    testRoot,
    databasePath,
    dataDir,
    distDir,
    tsconfigPath: relativeTsconfigPath,
    serverLogPath: assertOwnedTestPath(testRoot, path.join(testRoot, 'server.log'), {
      repoRoot: ROOT,
      label: 'workspace import server log',
    }),
  }
}

function createServerEnvironment(config) {
  return {
    ...process.env,
    RETALE_INTERNAL_ALLOW_TEST_OVERRIDES: '1',
    RETALE_SERVER_DATABASE_URL: `file:${config.databasePath}`,
    RETALE_SERVER_DATABASE_PATH: config.databasePath,
    RETALE_SERVER_DATA_DIR: config.dataDir,
    RETALE_SERVER_DIST_DIR: config.distDir,
    RETALE_SERVER_TEST_ROOT: config.testRoot,
    RETALE_SERVER_TSCONFIG_PATH: config.tsconfigPath,
    RETALE_TEST_ROOT: config.testRoot,
  }
}

async function waitForServer(server, getSpawnError) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const spawnError = getSpawnError()
    if (spawnError) throw spawnError
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Owned test server exited before readiness (code ${server.exitCode}, signal ${server.signalCode})`)
    }

    try {
      const response = await fetch(`${SERVER_URL}/library`, {
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok || response.status === 307 || response.status === 308) return
    } catch {
      // The dev server may refuse connections while compiling its first route.
    }
    await delay(1000)
  }

  throw new Error('Timed out waiting for owned test server on port 3000')
}

async function stopOwnedServer(server) {
  if (!server) return

  if (server.exitCode === null && server.signalCode === null) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }

    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(5000),
    ])

    if (server.exitCode === null && server.signalCode === null) {
      try {
        process.kill(-server.pid, 'SIGKILL')
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
      await Promise.race([
        new Promise((resolve) => server.once('exit', resolve)),
        delay(5000),
      ])
    }
  }

  assertPortReleased(PORT)
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate))
}

async function readJsonResponse(response, label) {
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${label} returned invalid JSON: ${text.slice(0, 300)}`)
  }
  return assertRecord(payload, `${label} response`)
}

async function verifyPatchAndTargetedGet(importPayload) {
  const patchResponse = await fetch(`${SERVER_URL}/api/chapters/${encodeURIComponent(importPayload.chapterId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: SERVER_URL,
      'Idempotency-Key': PATCH_IDEMPOTENCY_KEY,
      'X-Retale-Base-Revision': '1',
      'X-Retale-Revision-Novel-Id': importPayload.novelId,
    },
    body: JSON.stringify({
      novelId: importPayload.novelId,
      chapterId: importPayload.chapterId,
      content: PATCH_CONTENT,
      wordCount: PATCH_WORD_COUNT,
      updatedAtLabel: PATCH_UPDATED_AT_LABEL,
    }),
    signal: AbortSignal.timeout(30000),
  })
  const patchPayload = await readJsonResponse(patchResponse, 'Chapter PATCH')
  assertEqual(patchResponse.status, 200, 'Chapter PATCH status')
  assertEqual(patchPayload.ok, true, 'Chapter PATCH ok')
  assertEqual(patchPayload.operation, 'chapter-patch', 'Chapter PATCH operation')
  assertEqual(patchPayload.novelId, importPayload.novelId, 'Chapter PATCH novelId')
  assertEqual(patchPayload.chapterId, importPayload.chapterId, 'Chapter PATCH chapterId')
  assertEqual(patchPayload.revision, 2, 'Chapter PATCH revision')
  assertEqual(patchPayload.replayed, false, 'Chapter PATCH replayed')
  assertNonEmptyString(patchPayload.updatedAt, 'Chapter PATCH updatedAt')
  assertRevisionHeaders(patchResponse.headers, 2, importPayload.novelId, 'Chapter PATCH')

  const novelUrl = new URL(`/api/novels/${encodeURIComponent(importPayload.novelId)}`, SERVER_URL)
  const getResponse = await fetch(novelUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  })
  const workspacePayload = await readJsonResponse(getResponse, 'Novel GET')
  assertEqual(getResponse.status, 200, 'Novel GET status')
  assertEqual(workspacePayload.workspaceRevision, 2, 'Novel GET body revision')
  assertEqual(workspacePayload.revisionNovelId, importPayload.novelId, 'Novel GET body revision owner')
  assertRevisionHeaders(getResponse.headers, 2, importPayload.novelId, 'Novel GET')

  if (!Array.isArray(workspacePayload.localChapters)) {
    throw new Error('Novel GET localChapters must be an array')
  }
  const patchedChapter = workspacePayload.localChapters.find((chapter) => (
    typeof chapter === 'object' && chapter !== null && chapter.id === importPayload.chapterId
  ))
  if (!patchedChapter) {
    throw new Error(`Novel GET did not include patched chapter ${importPayload.chapterId}`)
  }
  assertEqual(patchedChapter.content, PATCH_CONTENT, 'Novel GET patched content')
  assertEqual(patchedChapter.wordCount, PATCH_WORD_COUNT, 'Novel GET patched wordCount')
  assertEqual(patchedChapter.updatedAt, PATCH_UPDATED_AT_LABEL, 'Novel GET patched updatedAt')
}

async function main() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`Missing fixture file: ${FIXTURE_PATH}`)
  }

  const config = createRuntimeConfig()
  let browser
  let server
  let serverLogFd
  let verificationPassed = false

  try {
    assertPortAvailable(HOST, PORT)
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.closeSync(fs.openSync(config.databasePath, 'wx'))
    serverLogFd = fs.openSync(config.serverLogPath, 'a')
    server = spawn(process.execPath, ['scripts/next-test-server.mjs'], {
      cwd: ROOT,
      env: createServerEnvironment(config),
      stdio: ['ignore', serverLogFd, serverLogFd],
      detached: true,
    })
    let serverSpawnError = null
    server.once('error', (error) => {
      serverSpawnError = error
    })
    await waitForServer(server, () => serverSpawnError)

    const executablePath = resolveChromeExecutable()
    browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })

    await page.goto(`${SERVER_URL}/library`, { waitUntil: 'networkidle' })
    await page.getByText('导入 TXT 小说').waitFor({ state: 'visible' })

    const importResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST',
      { timeout: 30000 },
    )
    await page.locator('input[type=file]').setInputFiles(FIXTURE_PATH)
    const importResponse = await importResponsePromise
    const importPayload = assertRecord(await importResponse.json(), 'TXT import response')
    assertEqual(importResponse.status(), 200, 'TXT import status')
    assertEqual(importPayload.ok, true, 'TXT import ok')
    assertNonEmptyString(importPayload.novelId, 'TXT import novelId')
    assertNonEmptyString(importPayload.chapterId, 'TXT import chapterId')
    assertEqual(importPayload.chapterCount, EXPECTED_CHAPTER_COUNT, 'TXT import chapterCount')
    assertEqual(importPayload.revision, 1, 'TXT import revision')
    assertRevisionHeaders(importResponse.headers(), 1, importPayload.novelId, 'TXT import')

    await page.waitForLoadState('networkidle')
    if (!/\/workspace$/.test(page.url())) {
      await page.goto(`${SERVER_URL}/workspace`, { waitUntil: 'networkidle' })
    }
    await page.getByText('章节导航').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByText('第1章 初入现场').waitFor({ state: 'visible', timeout: 30000 })

    await verifyPatchAndTargetedGet(importPayload)

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByText('章节导航').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByText('第1章 初入现场').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByTestId('workspace-chapter-body-view').getByText(PATCH_VISIBLE_TEXT, { exact: true })
      .waitFor({ state: 'visible', timeout: 30000 })

    const pageText = await page.locator('body').innerText()
    if (pageText.includes('正在恢复工作区')) {
      throw new Error('Workspace remained stuck on the restore screen after reload')
    }

    verificationPassed = true
    console.log('Workspace TXT import revision 1 to chapter PATCH revision 2 verification passed.')
  } catch (error) {
    console.error(`Server log: ${config.serverLogPath}`)
    throw error
  } finally {
    if (browser) await browser.close()
    try {
      await stopOwnedServer(server)
    } finally {
      if (serverLogFd !== undefined) fs.closeSync(serverLogFd)
      if (verificationPassed) {
        removeOwnedTestTree(config.testRoot, RUNS_ROOT, {
          repoRoot: ROOT,
          label: 'workspace import verification cleanup directory',
        })
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
