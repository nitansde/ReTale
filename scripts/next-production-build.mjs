import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeNextProductionSourceFingerprint,
  writeNextProductionBuildProvenance,
} from './next-production-provenance.mjs'

const require = createRequire(import.meta.url)
const nextCli = require.resolve('next/dist/bin/next')
const NEXT_BUILD_BUNDLER_FLAGS = new Set(['--webpack', '--turbopack', '--turbo'])

export function buildNextProductionBuildArgs(args = []) {
  const requestedArgs = [...args]
  if (!requestedArgs.some((arg) => NEXT_BUILD_BUNDLER_FLAGS.has(arg))) {
    requestedArgs.unshift('--webpack')
  }
  return ['build', ...requestedArgs]
}

export async function runNextProductionBuild(args = [], options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd())
  const environment = {
    ...process.env,
    ...options.environment,
    RETALE_NEXT_TSCONFIG_PATH: options.environment?.RETALE_NEXT_TSCONFIG_PATH?.trim()
      || process.env.RETALE_NEXT_TSCONFIG_PATH?.trim()
      || 'tsconfig.build.json',
  }
  const source = computeNextProductionSourceFingerprint(repoRoot)
  const spawnProcess = options.spawn ?? spawn
  const child = spawnProcess(process.execPath, [nextCli, ...buildNextProductionBuildArgs(args)], {
    cwd: repoRoot,
    env: environment,
    stdio: 'inherit',
  })

  let requestedSignal = null
  const forwardSignal = (signal) => {
    requestedSignal = signal
    if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill(signal)
  }
  const signalHandlers = new Map([
    ['SIGINT', () => forwardSignal('SIGINT')],
    ['SIGTERM', () => forwardSignal('SIGTERM')],
  ])
  for (const [signal, handler] of signalHandlers) process.once(signal, handler)
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  }).finally(() => {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler)
  })
  if (requestedSignal) {
    const error = new Error(`[retale-production-build] next build interrupted by ${requestedSignal}`)
    error.exitCode = requestedSignal === 'SIGINT' ? 130 : 143
    throw error
  }
  if (result.code !== 0) {
    throw new Error(`[retale-production-build] next build failed with exit code ${result.code ?? 'null'} and signal ${result.signal ?? 'none'}`)
  }
  const sourceAfterBuild = computeNextProductionSourceFingerprint(repoRoot)
  if (sourceAfterBuild.fingerprint !== source.fingerprint) {
    throw new Error('[retale-production-build] Production sources changed while next build was running. Run npm run build again.')
  }
  return writeNextProductionBuildProvenance({ repoRoot, environment, source })
}

async function main() {
  const { provenancePath } = await runNextProductionBuild(process.argv.slice(2))
  console.log(`[retale-production-build] Wrote source provenance ${path.relative(process.cwd(), provenancePath)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exitCode = error instanceof Error && 'exitCode' in error && Number.isInteger(error.exitCode)
      ? error.exitCode
      : 1
  })
}
