import { expect } from 'vitest'
import { createVitestFileRuntime } from '../../scripts/vitest-file-runtime.mjs'

const suiteRoot = process.env.RETALE_TEST_SUITE_ROOT
const testFile = expect.getState().testPath
if (!suiteRoot || !testFile) {
  throw new Error('[retale-vitest] Missing suite root or test path; run through scripts/run-vitest-suite.mjs')
}

// This setup runs before the setup module that imports application/database code.
Object.assign(process.env, createVitestFileRuntime({ suiteRoot, testFile }))
