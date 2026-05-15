import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync, spawn } from 'node:child_process'

const ROOT = process.cwd()
const PORT = 3000
const HOST = '127.0.0.1'
const SOURCE_DB_PATH = path.join(ROOT, 'dev.db')

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
    // No existing listener is fine.
  }
}

if (!fs.existsSync(SOURCE_DB_PATH)) {
  throw new Error(`Missing source database: ${SOURCE_DB_PATH}`)
}

killPort3000IfNeeded()

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbook-playwright-db-'))
const tempDbPath = path.join(tempDir, 'playwright.db')
fs.copyFileSync(SOURCE_DB_PATH, tempDbPath)

const child = spawn('npm', ['run', 'dev', '--', '--hostname', HOST, '--port', String(PORT)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
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
