import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkerDiagnostics } from '../../scripts/worker-diagnostics.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('bounded worker diagnostics', () => {
  it('rotates oversized output and prunes old workers while preserving unrelated files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-worker-logs-'))
    directories.push(directory)
    fs.writeFileSync(path.join(directory, 'keep.txt'), 'unrelated')
    for (let index = 1; index <= 25; index += 1) {
      const file = path.join(directory, `worker-1-${index}.log`)
      fs.writeFileSync(file, 'old')
      fs.utimesSync(file, 1, 1)
    }
    const logger = createWorkerDiagnostics(directory)
    logger.write(`initial-error ${'x'.repeat(1024 * 1024)}`)
    logger.write('latest-error')
    const logs = fs.readdirSync(directory).filter((name) => name.endsWith('.log'))
    expect(logs).toHaveLength(20)
    expect(logs.every((name) => fs.statSync(path.join(directory, name)).size <= 512 * 1024)).toBe(true)
    expect(logs.some((name) => fs.readFileSync(path.join(directory, name), 'utf8').includes('initial-error'))).toBe(true)
    expect(logs.some((name) => fs.readFileSync(path.join(directory, name), 'utf8').includes('latest-error'))).toBe(true)
    expect(fs.readFileSync(path.join(directory, 'keep.txt'), 'utf8')).toBe('unrelated')
  })
})
