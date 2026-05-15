import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = path.join(rootDir, '.sisyphus/evidence/task-1-test-harness/ui')

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
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
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/playwright-web-server.mjs',
    url: 'http://127.0.0.1:3000/library',
    timeout: 120_000,
    reuseExistingServer: false,
  },
})
