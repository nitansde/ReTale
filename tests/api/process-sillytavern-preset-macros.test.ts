import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const presetPath = path.join(root, 'tests/fixtures/preset-compat/synthetic-sillytavern-preset.json')

function sha256(filePath: string) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

describe('process-sillytavern-preset-macros CLI', () => {
  it('writes processed preset JSON to stdout without mixing warnings into stdout', () => {
    const contextPath = path.join(root, 'tests/fixtures/sillytavern-macro-context.json')

    const run = spawnSync(
      'node',
      ['scripts/process-sillytavern-preset-macros.mjs', presetPath, '--context', contextPath, '--user', 'Alice', '--char', 'Bob'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )

    expect(run.status).toBe(0)
    expect(run.stderr).toBe('')
    const parsed = JSON.parse(run.stdout) as { prompts: Array<{ content?: string }> }
    const joinedContents = parsed.prompts.map((prompt) => prompt.content ?? '').join('\n')
    expect(joinedContents).toContain('Alice')
    expect(joinedContents).toContain('Bob')
  })

  it('writes --out and --warnings artifacts without mutating the input preset', () => {
    const contextPath = path.join(root, 'tests/fixtures/sillytavern-macro-context.json')
    const checksumBefore = sha256(presetPath)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-macro-cli-'))
    const outPath = path.join(tempDir, 'out.json')
    const warningsPath = path.join(tempDir, 'warnings.json')

    const run = spawnSync(
      'node',
      ['scripts/process-sillytavern-preset-macros.mjs', presetPath, '--context', contextPath, '--user', 'Alice', '--char', 'Bob', '--out', outPath, '--warnings', warningsPath],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )

    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe('')
    expect(fs.existsSync(outPath)).toBe(true)
    expect(fs.existsSync(warningsPath)).toBe(true)
    expect(sha256(presetPath)).toBe(checksumBefore)

    const parsedOut = JSON.parse(fs.readFileSync(outPath, 'utf8')) as { prompts: Array<{ content?: string }> }
    const parsedWarnings = JSON.parse(fs.readFileSync(warningsPath, 'utf8')) as unknown[]
    const joinedContents = parsedOut.prompts.map((prompt) => prompt.content ?? '').join('\n')
    expect(joinedContents).toContain('Alice')
    expect(joinedContents).toContain('Bob')
    expect(Array.isArray(parsedWarnings)).toBe(true)
  })
})
