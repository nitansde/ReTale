import { execFileSync } from 'node:child_process'

export function detectListeningPids(port, options = {}) {
  const execute = options.execFileSync ?? execFileSync
  try {
    return execute('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().split(/\s+/u).filter(Boolean)
  } catch (error) {
    if (typeof error === 'object' && error && 'status' in error && error.status === 1) return []
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('[retale-production-port] Cannot verify listener state because lsof is unavailable', { cause: error })
    }
    throw new Error(`[retale-production-port] lsof failed while checking port ${port}`, { cause: error })
  }
}

export function assertPortAvailable(host, port, options = {}) {
  const pids = detectListeningPids(port, options)
  if (pids.length > 0) {
    throw new Error(`Refusing to use ${host}:${port}; listener PID(s): ${pids.join(', ')}`)
  }
}

export function assertPortReleased(port, options = {}) {
  const pids = detectListeningPids(port, options)
  if (pids.length > 0) {
    throw new Error(`Port ${port} remained occupied after stopping next start; listener PID(s): ${pids.join(', ')}`)
  }
}
