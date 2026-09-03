import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const TEMP_DIRS: string[] = []

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-hanlp-setup-'))
  TEMP_DIRS.push(dir)
  return dir
}

afterEach(() => {
  while (TEMP_DIRS.length) {
    fs.rmSync(TEMP_DIRS.pop()!, { recursive: true, force: true })
  }
})

describe('managed HanLP runtime setup', () => {
  it('rebuilds a broken managed venv, replaces a legacy env path, and reuses the healthy runtime', () => {
    const projectRoot = makeTempDir()
    const managedVenv = path.join(projectRoot, '.retale-hanlp-venv')
    const fakePython = path.join(projectRoot, 'fake-python.mjs')
    const invocationLog = path.join(projectRoot, 'python-invocations.log')
    const setupScript = path.resolve(process.cwd(), 'scripts', 'setup-hanlp-runtime.mjs')

    fs.mkdirSync(path.join(managedVenv, 'bin'), { recursive: true })
    fs.symlinkSync('/missing/homebrew/python3.13', path.join(managedVenv, 'bin', 'python'))
    fs.writeFileSync(path.join(projectRoot, '.env.local'), 'HANLP_PYTHON_BIN="/legacy/.chatbook-hanlp-venv/bin/python"\n')
    fs.writeFileSync(fakePython, `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_PYTHON_LOG, JSON.stringify(args) + '\\n')
if (args[0] === '-m' && args[1] === 'venv') {
  const target = args.at(-1)
  fs.mkdirSync(path.join(target, 'bin'), { recursive: true })
  fs.rmSync(path.join(target, 'bin', 'python'), { force: true })
  fs.copyFileSync(process.argv[1], path.join(target, 'bin', 'python'))
  fs.chmodSync(path.join(target, 'bin', 'python'), 0o755)
}
`)
    fs.chmodSync(fakePython, 0o755)

    const env = {
      ...process.env,
      FAKE_PYTHON_LOG: invocationLog,
      RETALE_HANLP_BOOTSTRAP_PYTHON: fakePython,
      RETALE_HANLP_VENV_DIR: managedVenv,
    }
    const first = spawnSync(process.execPath, [setupScript, '--ensure'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
    })
    const second = spawnSync(process.execPath, [setupScript, '--ensure'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
    })

    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(first.stdout).toContain('rebuilding venv')
    expect(second.stdout).toContain('reusing healthy HanLP runtime')
    expect(fs.readFileSync(path.join(projectRoot, '.env.local'), 'utf8')).toContain(
      `HANLP_PYTHON_BIN=${JSON.stringify(path.join(managedVenv, 'bin', 'python'))}`,
    )
    expect(fs.readFileSync(path.join(projectRoot, '.env.local'), 'utf8')).toContain(
      'HANLP_BOOTSTRAP_BATCH_SIZE="auto"',
    )

    const invocations = fs.readFileSync(invocationLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
    expect(invocations.filter((args) => args[0] === '-m' && args[1] === 'venv')).toEqual([
      ['-m', 'venv', '--clear', managedVenv],
    ])
    expect(invocations.some((args) => args[0] === '-c' && args[1]?.includes('pkg_resources'))).toBe(true)
    expect(invocations.some((args) => args.includes('setuptools==80.9.0'))).toBe(true)
    expect(invocations.some((args) => args.includes('nvidia-ml-py==13.610.43'))).toBe(true)
    expect(invocations.some((args) => args[0] === '-m' && args[1] === 'pip' && args.includes('uninstall') && args.includes('pynvml'))).toBe(true)
  })
})
