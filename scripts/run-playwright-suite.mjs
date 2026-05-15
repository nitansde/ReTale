import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const EVIDENCE_ROOT = path.join(ROOT, '.sisyphus/evidence/task-1-test-harness/ui')
const selector = process.argv[2] ?? ''

function killPort3000IfNeeded() {
  try {
    const output = execSync('lsof -ti tcp:3000 -sTCP:LISTEN', { stdio: ['ignore', 'pipe', 'ignore'] })
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

fs.mkdirSync(EVIDENCE_ROOT, { recursive: true })
killPort3000IfNeeded()

const args = ['playwright', 'test', '--config', 'playwright.config.mjs']
if (selector) {
  args.push('--grep', selector)
}

const result = spawnSync('npx', args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    TASK_EVIDENCE_DIR: path.join(ROOT, '.sisyphus/evidence/task-1-test-harness'),
  },
})

process.exit(result.status ?? 1)
