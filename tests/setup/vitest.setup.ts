import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import path from 'node:path'
import { assertOwnedTestDatabaseUrl, assertOwnedTestPath } from '../../scripts/test-path-safety.mjs'
import { resetNovelDatabaseTestState } from '@/tests/helpers/novel-db'

const repoRoot = process.cwd()
const testRoot = process.env.RETALE_TEST_ROOT
const sourceDbPath = process.env.RETALE_TEST_SOURCE_DB_PATH
const dataDir = process.env.RETALE_DATA_DIR
const databaseUrl = process.env.DATABASE_URL

if (!testRoot || !sourceDbPath || !dataDir || !databaseUrl) {
  throw new Error('[retale-vitest] Missing owned test runtime environment; run tests through scripts/run-vitest-suite.mjs')
}

assertOwnedTestDatabaseUrl(testRoot, databaseUrl, {
  repoRoot,
  label: 'Vitest DATABASE_URL',
})
assertOwnedTestPath(testRoot, path.resolve(repoRoot, dataDir), {
  repoRoot,
  label: 'Vitest RETALE_DATA_DIR',
})
assertOwnedTestPath(testRoot, path.resolve(repoRoot, sourceDbPath), {
  repoRoot,
  label: 'Vitest source database',
})

afterEach(() => {
  resetNovelDatabaseTestState()
})
