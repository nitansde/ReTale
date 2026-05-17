import { spawn } from 'node:child_process'

const args = process.argv.slice(2)

function hasOption(longName, shortName) {
  return args.some((arg) => arg === longName || arg.startsWith(`${longName}=`) || (shortName && arg === shortName))
}

const nextArgs = ['dev']

if (!hasOption('--hostname', '-H')) {
  nextArgs.push('--hostname', '0.0.0.0')
}

if (!hasOption('--port', '-p')) {
  nextArgs.push('--port', '14500')
}

nextArgs.push(...args)

const child = spawn('next', nextArgs, {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
