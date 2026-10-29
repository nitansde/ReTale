#!/usr/bin/env node
// `npx retale`: start the production build packed into the npm package.
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildNextProductionStartArgs } from './next-production-start.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nextCli = createRequire(import.meta.url).resolve('next/dist/bin/next')
// The library lives outside the package directory so upgrades and npx cache cleanups never touch it.
const dataDir = path.resolve(process.env.RETALE_DATA_DIR?.trim() || path.join(os.homedir(), '.retale', 'data'))
const env = {
  ...process.env,
  NODE_ENV: 'production',
  RETALE_DATA_DIR: dataDir,
  PORT: process.env.PORT?.trim() || '14500',
}

// npm may block the postinstall hook (allowScripts), so prepare or reuse the HanLP runtime on each start.
const hanlp = spawnSync(process.execPath, [path.join(packageRoot, 'scripts', 'setup-hanlp-runtime.mjs')], {
  cwd: packageRoot,
  env,
  stdio: 'inherit',
})
if (hanlp.status !== 0) {
  console.warn('[retale] HanLP setup failed; story analysis (knowledge building) stays unavailable. Set RETALE_SKIP_HANLP_SETUP=1 to skip it.')
}

console.log(`[retale] library data: ${dataDir}`)
const child = spawn(process.execPath, [nextCli, ...buildNextProductionStartArgs(process.argv.slice(2), env)], {
  cwd: packageRoot,
  env,
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(code ?? (signal === 'SIGINT' ? 130 : 143)))
