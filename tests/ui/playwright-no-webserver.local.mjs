import path from 'node:path'
import { defineConfig } from '@playwright/test'

const rootDir = path.resolve(import.meta.dirname, '..', '..')
const evidenceDir = path.join(rootDir, '.sisyphus/evidence/task-16-final-gate/ui')

export default defineConfig({
  testDir: path.join(rootDir, 'tests/ui'),
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(evidenceDir, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(evidenceDir, 'playwright-report.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
