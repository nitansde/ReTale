import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const DEFAULT_VENV_DIR = path.resolve(ROOT, '..', '.retale-hanlp-venv')
const PYTHON_CANDIDATES = ['python3.13', 'python3.12', 'python3.11', 'python3']
const REQUIRED_PACKAGES = ['hanlp==2.1.3', 'transformers==4.57.6']

const args = new Set(process.argv.slice(2))
const postinstall = args.has('--postinstall')
const runSmoke = args.has('--smoke')

function log(message) {
  console.log(`[setup-hanlp-runtime] ${message}`)
}

function fail(message) {
  console.error(`[setup-hanlp-runtime] ${message}`)
  process.exit(1)
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: options.stdio ?? (options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit']),
    env: options.env ?? process.env,
    input: options.input,
    encoding: options.encoding,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} exited with status ${result.status}`)
  }

  return result
}

function commandWorks(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function selectPython() {
  const explicit = process.env.RETALE_HANLP_BOOTSTRAP_PYTHON?.trim()
  if (explicit) {
    if (!commandWorks(explicit, ['-c', 'import venv'])) {
      fail(`RETALE_HANLP_BOOTSTRAP_PYTHON is not usable for venv: ${explicit}`)
    }
    return explicit
  }

  for (const candidate of PYTHON_CANDIDATES) {
    if (commandWorks(candidate, ['-c', 'import venv'])) {
      return candidate
    }
  }

  fail(`No usable Python with venv support found. Tried: ${PYTHON_CANDIDATES.join(', ')}`)
}

function venvPythonPath(venvDir) {
  if (process.platform === 'win32') {
    return path.join(venvDir, 'Scripts', 'python.exe')
  }
  return path.join(venvDir, 'bin', 'python')
}

function ensureVenv(venvDir) {
  const pythonPath = venvPythonPath(venvDir)
  if (fs.existsSync(pythonPath)) {
    return pythonPath
  }

  fs.mkdirSync(path.dirname(venvDir), { recursive: true })
  const python = selectPython()
  log(`creating venv with ${python}: ${venvDir}`)
  run(python, ['-m', 'venv', venvDir])
  return pythonPath
}

function ensurePackages(pythonPath) {
  log(`installing pinned HanLP runtime packages with ${pythonPath}`)
  run(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel', ...REQUIRED_PACKAGES])
  run(pythonPath, ['-c', [
    'import hanlp, transformers',
    'from transformers import BertTokenizer',
    'assert hasattr(BertTokenizer, "encode_plus")',
    'print(f"hanlp={hanlp.__version__} transformers={transformers.__version__}")',
  ].join('; ')])
}

function setEnvLine(existing, key, value) {
  const line = `${key}=${JSON.stringify(value)}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(existing)) {
    return existing.replace(pattern, line)
  }
  return `${existing.replace(/\s*$/, '')}\n${line}\n`
}

function ensureLocalEnv(pythonPath) {
  const envPath = path.join(ROOT, '.env.local')
  const scriptPath = path.join(ROOT, 'hanlp_bootstrap.py')
  let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  contents = setEnvLine(contents, 'HANLP_PYTHON_BIN', pythonPath)
  contents = setEnvLine(contents, 'HANLP_BOOTSTRAP_SCRIPT_PATH', scriptPath)
  contents = setEnvLine(contents, 'HANLP_BOOTSTRAP_PARALLELISM', process.env.HANLP_BOOTSTRAP_PARALLELISM?.trim() || '1')
  contents = setEnvLine(contents, 'HANLP_BOOTSTRAP_BATCH_SIZE', process.env.HANLP_BOOTSTRAP_BATCH_SIZE?.trim() || '256')
  fs.writeFileSync(envPath, contents)
  log(`updated ${path.relative(ROOT, envPath)}`)
}

function smokeTest(pythonPath) {
  const request = JSON.stringify({
    novelId: 'smoke',
    branchId: 'smoke:main',
    chapterId: 'ch1',
    chapterNo: 1,
    chapterText: '林澄走进示例城，遇见周禾。',
    outputSchemaVersion: 'v1',
  })
  log('running HanLP bootstrap smoke test')
  run(pythonPath, ['hanlp_bootstrap.py'], {
    input: `${request}\n`,
    encoding: 'utf8',
    env: {
      ...process.env,
      HANLP_PYTHON_BIN: pythonPath,
    },
  })
}

if (process.env.RETALE_SKIP_HANLP_SETUP === '1') {
  log('skipped because RETALE_SKIP_HANLP_SETUP=1')
  process.exit(0)
}

try {
  const venvDir = path.resolve(process.env.RETALE_HANLP_VENV_DIR?.trim() || DEFAULT_VENV_DIR)
  const pythonPath = ensureVenv(venvDir)
  ensurePackages(pythonPath)
  ensureLocalEnv(pythonPath)
  if (runSmoke) {
    smokeTest(pythonPath)
  }
  log('HanLP runtime is ready')
} catch (error) {
  const suffix = postinstall ? ' Set RETALE_SKIP_HANLP_SETUP=1 to skip this postinstall step.' : ''
  fail(`${error instanceof Error ? error.message : String(error)}.${suffix}`)
}
