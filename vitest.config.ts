import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tests/**/*.test.mts', 'tests/**/*.test.mjs'],
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    globals: true,
    passWithNoTests: false,
    pool: 'forks',
    reporters: ['default'],
  },
})
