import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const nextCli = require.resolve('next/dist/bin/next')

export function buildNextProductionStartArgs(args, environment = process.env) {
  const hasHostname = args.some((argument) => argument === '--hostname' || argument === '-H' || argument.startsWith('--hostname='))
  const hostname = environment.RETALE_PRODUCTION_HOST?.trim() || '127.0.0.1'
  return ['start', ...(hasHostname ? [] : ['--hostname', hostname]), ...args]
}

function main() {
  const nextArgs = buildNextProductionStartArgs(process.argv.slice(2))
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
