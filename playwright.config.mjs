import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import { SAFE_QA_BASE_URL, SAFE_QA_LIBRARY_URL } from './scripts/roleplay-safe-qa.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(rootDir, 'tests/artifacts/evidence/task-1-test-harness/ui')

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: process.env.PLAYWRIGHT_TEST_DB_PATH ? 1 : undefined,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  outputDir: path.join(evidenceDir, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(evidenceDir, 'playwright-report.json') }],
    ['html', { outputFolder: path.join(evidenceDir, 'html-report'), open: 'never' }],
  ],
  use: {
    baseURL: SAFE_QA_BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/playwright-web-server.mjs',
    url: SAFE_QA_LIBRARY_URL,
    timeout: 120_000,
    reuseExistingServer: false,
  },
})
