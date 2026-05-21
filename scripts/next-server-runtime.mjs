import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const require = createRequire(import.meta.url)
const NEXT_CLI_ENTRYPOINT = require.resolve('next/dist/bin/next')

const SERVER_MODES = {
  prod: {
    label: 'daily/prod dev server',
    host: '0.0.0.0',
    port: 14500,
    databaseUrl: 'file:./dev.db',
    databasePath: path.join(ROOT, 'dev.db'),
    distDir: '',
    tsconfigPath: 'tsconfig.json',
  },
  test: {
    label: 'isolated test dev server',
    host: '127.0.0.1',
    port: 3000,
    databaseUrl: 'file:.sisyphus/runtime/test-server/dev-test.db',
    databasePath: path.join(ROOT, '.sisyphus', 'runtime', 'test-server', 'dev-test.db'),
    distDir: path.join('.sisyphus', 'runtime', 'next-test-server'),
    tsconfigPath: path.join('.sisyphus', 'runtime', 'test-server', 'tsconfig.json'),
  },
}

const SISYPHUS_ROOT = path.join(ROOT, '.sisyphus')
const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
}

const FORBIDDEN_NEXT_FLAGS = [
  { longName: '--hostname', shortName: '-H' },
  { longName: '--port', shortName: '-p' },
]

function getModeConfig(mode) {
  const config = SERVER_MODES[mode]
  if (!config) {
    throw new Error(`[chatbook-server] Unsupported mode "${mode}". Expected one of: ${Object.keys(SERVER_MODES).join(', ')}`)
  }
  return config
}

function hasOption(longName, shortName) {
  return args.some((arg) => arg === longName || arg.startsWith(`${longName}=`) || (shortName && arg === shortName))
}

function findForbiddenOption() {
  for (const flag of FORBIDDEN_NEXT_FLAGS) {
    if (hasOption(flag.longName, flag.shortName)) {
      return flag
    }
  }

  return null
}

function isSubPathOf(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function resolveModeConfig(mode) {
  const baseConfig = getModeConfig(mode)
  const allowInternalTestOverrides = mode === 'test' && process.env.CHATBOOK_INTERNAL_ALLOW_TEST_OVERRIDES === '1'
  const overrideDatabaseUrl = allowInternalTestOverrides ? process.env.CHATBOOK_SERVER_DATABASE_URL?.trim() : undefined
  const overrideDatabasePath = allowInternalTestOverrides ? process.env.CHATBOOK_SERVER_DATABASE_PATH?.trim() : undefined
  const overrideDistDir = allowInternalTestOverrides ? process.env.CHATBOOK_SERVER_DIST_DIR?.trim() : undefined

  const config = {
    ...baseConfig,
    databaseUrl: overrideDatabaseUrl || baseConfig.databaseUrl,
    databasePath: overrideDatabasePath || baseConfig.databasePath,
    distDir: overrideDistDir ?? baseConfig.distDir,
  }

  if (mode === 'test') {
    if (!isSubPathOf(SISYPHUS_ROOT, config.databasePath)) {
      throw new Error(`[chatbook-server] Test mode database must stay under .sisyphus: ${config.databasePath}`)
    }

    const resolvedDistDir = path.join(ROOT, config.distDir)
    if (!isSubPathOf(SISYPHUS_ROOT, resolvedDistDir)) {
      throw new Error(`[chatbook-server] Test mode dist dir must stay under .sisyphus: ${config.distDir}`)
    }
  }

  return config
}

function ensurePortAvailable(host, port) {
  try {
    const output = execFileSync('lsof', ['-nP', '-iTCP:' + String(port), '-sTCP:LISTEN', '-t'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()

    if (!output) {
      return
    }

    const pids = output.split(/\s+/).filter(Boolean)
    throw new Error(
      `[chatbook-server] Refusing to start because ${host}:${port} is already in use by PID(s): ${pids.join(', ')}. `
      + 'Stop that listener manually before starting this server.'
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[chatbook-server]')) {
      throw error
    }

    if (typeof error === 'object' && error && 'status' in error && error.status === 1) {
      return
    }

    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }

    throw error
  }
}

function ensureModeFilesystem(config) {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true })

  if (config.distDir) {
    fs.mkdirSync(path.join(ROOT, config.distDir), { recursive: true })
  }

   if (config.tsconfigPath) {
    fs.mkdirSync(path.dirname(path.join(ROOT, config.tsconfigPath)), { recursive: true })
  }
}

function ensureIsolatedTestTsconfig(config) {
  if (!config.tsconfigPath || config.tsconfigPath === 'tsconfig.json') {
    return
  }

  const tsconfigContents = {
    extends: '../../../tsconfig.json',
  }

  fs.writeFileSync(path.join(ROOT, config.tsconfigPath), `${JSON.stringify(tsconfigContents, null, 2)}\n`)
}

function printHelp(invokedAs) {
  console.log(`Usage: node ${invokedAs} [-- --next-cli-args]\n`)
  console.log('This wrapper starts a ChatBook Next dev server with an isolated runtime profile.')
  console.log('Host and port are fixed per profile; --hostname/-H and --port/-p are rejected.')
  console.log('')
  console.log('Profiles:')
  console.log('  next-dev.mjs        0.0.0.0:14500 + file:./dev.db + default .next')
  console.log('  next-test-server.mjs 127.0.0.1:3000 + file:.sisyphus/runtime/test-server/dev-test.db + .sisyphus/runtime/next-test-server')
  console.log('')
  console.log('Flags:')
  console.log('  --help           Show this help message')
  console.log('  --print-config   Print resolved runtime config and exit')
}

export function runNextServer(mode, invokedAs) {
  if (args.includes('--help')) {
    printHelp(invokedAs)
    return
  }

  const forbiddenOption = findForbiddenOption()
  if (forbiddenOption) {
    throw new Error(
      `[chatbook-server] ${invokedAs} uses a fixed ${mode} profile and does not accept ${forbiddenOption.longName}`
      + `/${forbiddenOption.shortName}. Use the script without host/port overrides.`
    )
  }

  const config = resolveModeConfig(mode)

  const runtimeConfig = {
    mode,
    label: config.label,
    host: config.host,
    port: config.port,
    databaseUrl: config.databaseUrl,
    databasePath: config.databasePath,
    distDir: config.distDir || '.next',
    tsconfigPath: config.tsconfigPath,
  }

  if (args.includes('--print-config')) {
    console.log(`${JSON.stringify(runtimeConfig, null, 2)}\n`)
    return
  }

  ensurePortAvailable(config.host, config.port)
  ensureModeFilesystem(config)
  ensureIsolatedTestTsconfig(config)

  const nextArgs = ['dev', '--hostname', config.host, '--port', String(config.port), ...args]

  console.log(`[chatbook-server] Starting ${config.label} at http://${config.host}:${config.port}`)
  console.log(`[chatbook-server] Forcing DATABASE_URL=${config.databaseUrl}`)
  console.log(`[chatbook-server] Using Next dist dir ${runtimeConfig.distDir}`)

  const child = spawn(process.execPath, [NEXT_CLI_ENTRYPOINT, ...nextArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: config.databaseUrl,
      CHATBOOK_NEXT_DIST_DIR: config.distDir,
      CHATBOOK_NEXT_TSCONFIG_PATH: config.tsconfigPath,
    },
  })

  let forwardedSignal = null
  const stop = (signal = 'SIGTERM') => {
    forwardedSignal = signal

    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill(signal)
    }
  }

  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(SIGNAL_EXIT_CODES[forwardedSignal ?? signal] ?? 1)
      return
    }

    process.exit(code ?? 0)
  })
}
