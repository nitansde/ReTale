import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPortAvailable } from './production-port-safety.mjs'
import { assertNextProductionBuildProvenance } from './next-production-provenance.mjs'

const require = createRequire(import.meta.url)
const nextCli = require.resolve('next/dist/bin/next')

export function buildNextProductionStartArgs(args, environment = process.env) {
  const hasHostname = args.some((argument) => argument === '--hostname'
    || argument === '-H'
    || argument.startsWith('--hostname=')
    || (argument.startsWith('-H') && argument.length > 2))
  const hostname = environment.RETALE_PRODUCTION_HOST?.trim() || '127.0.0.1'
  return ['start', ...(hasHostname ? [] : ['--hostname', hostname]), ...args]
}

function readOption(args, names) {
  let value = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (names.includes(argument)) {
      const nextValue = args[index + 1]
      if (!nextValue || nextValue.startsWith('-')) {
        throw new Error(`[retale-production-port] ${argument} requires a value`)
      }
      value = nextValue
      index += 1
      continue
    }
    const longName = names.find((name) => name.startsWith('--') && argument.startsWith(`${name}=`))
    if (longName) {
      value = argument.slice(longName.length + 1)
      continue
    }
    const shortName = names.find((name) => name.startsWith('-') && !name.startsWith('--') && argument.startsWith(name) && argument.length > name.length)
    if (shortName) {
      value = argument.slice(shortName.length)
    }
  }
  return value
}

function parsePort(value) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`[retale-production-port] Invalid production port: ${value}`)
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`[retale-production-port] Production port must be between 1 and 65535: ${value}`)
  }
  return port
}

export function resolveNextProductionBinding(args, environment = process.env) {
  const hostname = readOption(args, ['--hostname', '-H'])
    ?? (environment.RETALE_PRODUCTION_HOST?.trim() || '127.0.0.1')
  const portValue = readOption(args, ['--port', '-p'])
    ?? (environment.PORT?.trim() || '3000')
  if (!hostname) {
    throw new Error('[retale-production-port] Production hostname must not be empty')
  }
  return { hostname, port: parsePort(portValue) }
}

export function prepareNextProductionStart(args, environment = process.env, options = {}) {
  const nextArgs = buildNextProductionStartArgs(args, environment)
  const binding = resolveNextProductionBinding(nextArgs.slice(1), environment)
  const provenance = assertNextProductionBuildProvenance({
    repoRoot: options.repoRoot,
    environment,
  })
  assertPortAvailable(binding.hostname, binding.port, options.portDetection)
  return { binding, nextArgs, provenance }
}

function main() {
  const { nextArgs } = prepareNextProductionStart(process.argv.slice(2))
  const child = spawn(process.execPath, [nextCli, ...nextArgs], { stdio: 'inherit', env: process.env })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }

  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT') process.exit(130)
    if (signal === 'SIGTERM') process.exit(143)
    process.exit(code ?? 1)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
