import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const FIXTURE_PATH = path.join(ROOT, 'scripts/fixtures/workspace-import-smoke.txt')
const SOURCE_DB_PATH = path.join(ROOT, 'dev.db')
const PORT = 3000
const HOST = '127.0.0.1'
const SERVER_URL = `http://${HOST}:${PORT}`

function killPort3000IfNeeded() {
  try {
    const output = execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (!output) return

    for (const pid of output.split(/\s+/).filter(Boolean)) {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
    }
  } catch {
    // no listener is fine
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${SERVER_URL}/library`, { redirect: 'manual' })
      if (response.ok || response.status === 307 || response.status === 308) return
    } catch {
      // keep waiting
    }
    await delay(1000)
  }

  throw new Error('Timed out waiting for local server on port 3000')
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate))
}

async function main() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`Missing fixture file: ${FIXTURE_PATH}`)
  }
  if (!fs.existsSync(SOURCE_DB_PATH)) {
    throw new Error(`Missing source database: ${SOURCE_DB_PATH}`)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-workspace-import-'))
  const tempDbPath = path.join(tempDir, 'verify.db')
  fs.copyFileSync(SOURCE_DB_PATH, tempDbPath)

  killPort3000IfNeeded()

  const serverLogPath = path.join(tempDir, 'server.log')
  const serverLogFd = fs.openSync(serverLogPath, 'a')
  const server = spawn('npm', ['run', 'start', '--', '--hostname', HOST, '--port', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: `file:${tempDbPath}`,
    },
    stdio: ['ignore', serverLogFd, serverLogFd],
  })

  let browser
  try {
    await waitForServer()

    const executablePath = resolveChromeExecutable()
    browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })

    await page.goto(`${SERVER_URL}/library`, { waitUntil: 'networkidle' })
    await page.getByText('导入 TXT 小说').waitFor({ state: 'visible' })

    const fileInput = page.locator('input[type=file]')
    const importResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST',
      { timeout: 30000 },
    )
    await fileInput.setInputFiles(FIXTURE_PATH)
    const importResponse = await importResponsePromise
    if (!importResponse.ok()) {
      throw new Error(`Import request failed with status ${importResponse.status()}`)
    }

    await page.waitForLoadState('networkidle')
    if (!/\/workspace$/.test(page.url())) {
      await page.goto(`${SERVER_URL}/workspace`, { waitUntil: 'networkidle' })
    }

    await page.getByText('章节导航').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByText('第1章 初入现场').waitFor({ state: 'visible', timeout: 30000 })

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByText('章节导航').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByText('第1章 初入现场').waitFor({ state: 'visible', timeout: 30000 })

    const pageText = await page.locator('body').innerText()
    if (pageText.includes('正在恢复工作区')) {
      throw new Error('Workspace remained stuck on the restore screen after reload')
    }

    console.log('Workspace import/restore smoke check passed.')
    console.log(`Server log: ${serverLogPath}`)
  } catch (error) {
    console.error(`Server log: ${serverLogPath}`)
    throw error
  } finally {
    if (browser) {
      await browser.close()
    }

    if (!server.killed) {
      server.kill('SIGKILL')
    }
    fs.closeSync(serverLogFd)
    killPort3000IfNeeded()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
