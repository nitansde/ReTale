import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'
import { CONTROL_SCHEMA_SQL, FULL_SCHEMA_SQL } from '../lib/server/schema.ts'
import {
  assertOwnedTestDatabaseUrl,
  assertOwnedTestPath,
  createOwnedTestRoot,
  removeOwnedTestTree,
} from './test-path-safety.mjs'
import { buildNextProductionBuildArgs } from './next-production-build.mjs'
import { assertPortAvailable, assertPortReleased } from './production-port-safety.mjs'

const ROOT = process.cwd()
const require = createRequire(import.meta.url)
const NEXT_CLI_ENTRYPOINT = require.resolve('next/dist/bin/next')
const RUNS_ROOT = path.join(ROOT, '.sisyphus', 'runtime', 'production-smoke-runs')
const HOST = '127.0.0.1'
const PORT = 3000
const BASE_URL = `http://${HOST}:${PORT}`
const TASK_MARKER = `production-freshness-${Date.now()}-${process.pid}`
const NOVEL_ID = 'production-smoke-novel'
const BRANCH_ID = `${NOVEL_ID}:main`
let activeChild = null
let requestedSignal = null

function createRuntimeEnvironment(config) {
  const allowedNames = [
    'CI',
    'FORCE_COLOR',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'NO_COLOR',
    'PATH',
    'SHELL',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'TERM',
    'TMPDIR',
    'TZ',
    'USER',
  ]
  const environment = Object.fromEntries(
    allowedNames.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]),
  )
  return {
    ...environment,
    DATABASE_URL: config.databaseUrl,
    NODE_ENV: 'production',
    RETALE_DATA_DIR: config.dataDir,
    RETALE_NEXT_DIST_DIR: config.distDir,
    RETALE_NEXT_TSCONFIG_PATH: 'tsconfig.build.json',
    RETALE_TEST_ROOT: config.testRoot,
  }
}

function createRuntimeConfig() {
  const testRoot = createOwnedTestRoot(RUNS_ROOT, `${Date.now()}-${process.pid}-`, { repoRoot: ROOT })
  const databasePath = assertOwnedTestPath(testRoot, path.join(testRoot, 'legacy.db'), {
    repoRoot: ROOT,
    label: 'production smoke legacy database',
  })
  const dataDir = assertOwnedTestPath(testRoot, path.join(testRoot, 'data'), {
    repoRoot: ROOT,
    label: 'production smoke data directory',
  })
  const distPath = assertOwnedTestPath(testRoot, path.join(testRoot, 'next-dist'), {
    repoRoot: ROOT,
    label: 'production smoke Next dist directory',
  })
  const databaseUrl = `file:${databasePath}`
  assertOwnedTestDatabaseUrl(testRoot, databaseUrl, {
    repoRoot: ROOT,
    label: 'production smoke DATABASE_URL',
  })
  return {
    testRoot,
    databasePath,
    databaseUrl,
    dataDir,
    distDir: path.relative(ROOT, distPath),
    distPath,
  }
}

function seedRuntime(config) {
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.closeSync(fs.openSync(config.databasePath, 'wx'))

  const novelDirectory = path.join(config.dataDir, 'novels', NOVEL_ID)
  const novelDbPath = path.join(novelDirectory, 'novel.db')
  const lanceDbPath = path.join(novelDirectory, 'lancedb')
  fs.mkdirSync(novelDirectory, { recursive: true })

  const controlDb = new DatabaseSync(path.join(config.dataDir, 'control.db'))
  controlDb.exec(CONTROL_SCHEMA_SQL)
  controlDb.prepare(
    `INSERT INTO NovelRegistry (novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus)
     VALUES (?, ?, ?, ?, ?, '1', 'ready')`
  ).run(NOVEL_ID, NOVEL_ID, 'Production Smoke Novel', novelDbPath, lanceDbPath)
  controlDb.close()

  const novelDb = new DatabaseSync(novelDbPath)
  novelDb.exec(FULL_SCHEMA_SQL)
  novelDb.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)')
    .run(NOVEL_ID, 'Production Smoke Novel', 'workspace')
  novelDb.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)')
    .run(BRANCH_ID, NOVEL_ID, 'main')
  novelDb.close()
  return novelDbPath
}

function insertFreshTask(novelDbPath) {
  const database = new DatabaseSync(novelDbPath)
  try {
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, progress, currentStep, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      TASK_MARKER,
      NOVEL_ID,
      BRANCH_ID,
      'rebuild_retrieval_index',
      'paused',
      0.5,
      TASK_MARKER,
      JSON.stringify({ steps: [] }),
    )
  } finally {
    database.close()
  }
}

async function fetchRoute(route) {
  const response = await fetch(`${BASE_URL}${route}`, {
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${route} returned ${response.status}`)
  return body
}

async function waitForServer(server, getSpawnError) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const spawnError = getSpawnError()
    if (spawnError) throw spawnError
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`next start exited before readiness (code ${server.exitCode}, signal ${server.signalCode})`)
    }
    try {
      await fetchRoute('/library')
      return
    } catch {
      await delay(1000)
    }
  }
  throw new Error('Timed out waiting for next start on port 3000')
}

async function stopServer(server) {
  if (server && server.exitCode === null && server.signalCode === null) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(5000)])
    if (server.exitCode === null && server.signalCode === null) {
      try {
        process.kill(-server.pid, 'SIGKILL')
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    }
  }
  assertPortReleased(PORT)
}

function stopActiveChild(signal = 'SIGTERM') {
  if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return
  try {
    process.kill(-activeChild.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function main() {
  const config = createRuntimeConfig()
  if (process.argv.includes('--print-config')) {
    console.log(JSON.stringify(config, null, 2))
    return
  }

  let server = null
  const stopForSignal = (signal) => {
    requestedSignal = signal
    stopActiveChild(signal)
  }
  process.once('SIGINT', () => stopForSignal('SIGINT'))
  process.once('SIGTERM', () => stopForSignal('SIGTERM'))

  try {
    assertPortAvailable(HOST, PORT)
    const novelDbPath = seedRuntime(config)
    const runtimeEnv = createRuntimeEnvironment(config)

    console.log(`[retale-production-smoke] Building with owned runtime ${config.testRoot}`)
    const build = spawn(process.execPath, [NEXT_CLI_ENTRYPOINT, ...buildNextProductionBuildArgs()], {
      cwd: ROOT,
      env: runtimeEnv,
      stdio: 'inherit',
      detached: true,
    })
    activeChild = build
    const buildResult = await new Promise((resolve, reject) => {
      build.once('error', reject)
      build.once('exit', (code, signal) => resolve({ code, signal }))
    })
    activeChild = null
    if (requestedSignal) throw new Error(`Production freshness verification interrupted by ${requestedSignal}`)
    if (buildResult.code !== 0) {
      throw new Error(`next build failed with exit code ${buildResult.code} and signal ${buildResult.signal ?? 'none'}`)
    }

    server = spawn(process.execPath, [NEXT_CLI_ENTRYPOINT, 'start', '--hostname', HOST, '--port', String(PORT)], {
      cwd: ROOT,
      env: runtimeEnv,
      stdio: 'inherit',
      detached: true,
    })
    activeChild = server
    let serverSpawnError = null
    server.once('error', (error) => {
      serverSpawnError = error
    })
    await waitForServer(server, () => serverSpawnError)
    await fetchRoute('/workspace')
    const initialTaskPage = await fetchRoute('/task')
    if (initialTaskPage.includes(TASK_MARKER)) throw new Error('/task contained the freshness marker before mutation')

    insertFreshTask(novelDbPath)
    const freshTaskPage = await fetchRoute('/task')
    if (!freshTaskPage.includes(TASK_MARKER)) {
      throw new Error('/task did not reflect post-build task-state mutation without rebuilding')
    }

    console.log('[retale-production-smoke] /library, /workspace, and /task passed; /task reflected post-build SQLite state.')
  } finally {
    try {
      await stopServer(server)
    } finally {
      activeChild = null
      removeOwnedTestTree(config.testRoot, RUNS_ROOT, {
        repoRoot: ROOT,
        label: 'production smoke cleanup directory',
      })
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = requestedSignal === 'SIGINT' ? 130 : requestedSignal === 'SIGTERM' ? 143 : 1
})
