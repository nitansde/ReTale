import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const EVIDENCE_ROOT = path.join(ROOT, '.sisyphus/evidence/task-1-test-harness')

const suite = process.argv[2]
const selector = process.argv[3] ?? 'all'

if (!suite || !['unit', 'api'].includes(suite)) {
  console.error(`Unknown Vitest suite: ${suite ?? '<missing>'}`)
  process.exit(1)
}

const suiteRoots = suite === 'unit'
  ? [path.join(ROOT, 'tests/unit'), path.join(ROOT, 'tests/component')]
  : [path.join(ROOT, 'tests/api')]

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
      continue
    }

    if (/\.test\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

const availableTests = suiteRoots.flatMap(walk).sort()
const selectedTests = selector === 'all'
  ? availableTests
  : availableTests.filter((filePath) => filePath.includes(selector))

if (!selectedTests.length) {
  console.error(`No ${suite} tests matched selector: ${selector}`)
  process.exit(1)
}

fs.mkdirSync(EVIDENCE_ROOT, { recursive: true })
const outputFile = path.join(EVIDENCE_ROOT, `${suite}-report.json`)

const result = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.config.ts', '--reporter=default', `--reporter=json`, `--outputFile=${outputFile}`, ...selectedTests],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      TASK_EVIDENCE_DIR: EVIDENCE_ROOT,
    },
  }
)

process.exit(result.status ?? 1)
