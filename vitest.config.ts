import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { resolveTestWorkers } from './scripts/vitest-file-runtime.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const workers = resolveTestWorkers()

export default defineConfig({
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tests/**/*.test.mts', 'tests/**/*.test.mjs'],
    setupFiles: ['./tests/setup/vitest-runtime.ts', './tests/setup/vitest.setup.ts'],
    sequence: { setupFiles: 'list' },
    globals: true,
    passWithNoTests: false,
    pool: 'forks',
    fileParallelism: workers > 1,
    maxWorkers: workers,
    reporters: ['default'],
  },
})
