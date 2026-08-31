import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertOwnedTestPath, createOwnedTestRoot } from './test-path-safety.mjs'

const ROOT = process.cwd()
const EVIDENCE_ROOT = path.join(ROOT, '.sisyphus/evidence/task-1-test-harness')
const TEST_RUNS_ROOT = path.join(ROOT, 'tests', '.runtime', 'test-runs')

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
const testRoot = createOwnedTestRoot(TEST_RUNS_ROOT, `${suite}-${Date.now()}-${process.pid}-`, { repoRoot: ROOT })
const sourceDbPath = assertOwnedTestPath(testRoot, path.join(testRoot, 'source.db'), {
  repoRoot: ROOT,
  label: 'Vitest source database',
})
const runtimeDbPath = assertOwnedTestPath(testRoot, path.join(testRoot, 'runtime.db'), {
  repoRoot: ROOT,
  label: 'Vitest runtime database',
})
const dataDir = assertOwnedTestPath(testRoot, path.join(testRoot, 'data'), {
  repoRoot: ROOT,
  label: 'Vitest data directory',
})
const tempDir = assertOwnedTestPath(testRoot, path.join(testRoot, 'tmp'), {
  repoRoot: ROOT,
  label: 'Vitest temporary directory',
})

fs.closeSync(fs.openSync(sourceDbPath, 'wx'))
fs.mkdirSync(tempDir, { recursive: true })

const outputFile = path.join(EVIDENCE_ROOT, `${suite}-report.json`)

console.log(`[retale-vitest] Owned test root ${testRoot}`)
console.log(`[retale-vitest] Dedicated source test DB ${sourceDbPath}`)
console.log(`[retale-vitest] Runtime DATABASE_URL=file:${runtimeDbPath}`)
console.log(`[retale-vitest] Runtime RETALE_DATA_DIR=${dataDir}`)

const result = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.config.ts', '--reporter=default', `--reporter=json`, `--outputFile=${outputFile}`, ...selectedTests],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--no-experimental-webstorage'].filter(Boolean).join(' '),
      RETALE_TEST_ROOT: testRoot,
      RETALE_TEST_SOURCE_DB_PATH: sourceDbPath,
      DATABASE_URL: `file:${runtimeDbPath}`,
      RETALE_DATA_DIR: dataDir,
      TMPDIR: tempDir,
      TMP: tempDir,
      TEMP: tempDir,
      TASK_EVIDENCE_DIR: EVIDENCE_ROOT,
    },
  }
)

process.exit(result.status ?? 1)
