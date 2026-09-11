import fs from 'node:fs'
import path from 'node:path'

const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES = 20

/** Each process owns its files; retention also bounds logs left by exited workers. */
export function createWorkerDiagnostics(directory) {
  const prefix = `worker-${Date.now()}-${process.pid}`
  const current = path.join(directory, `${prefix}.log`)
  const previous = path.join(directory, `${prefix}.1.log`)

  function prune() {
    const files = fs.readdirSync(directory)
      .filter((name) => /^worker-\d+-\d+(?:\.1)?\.log$/u.test(name))
      .flatMap((name) => {
        try {
          return [{ name, modified: fs.statSync(path.join(directory, name)).mtimeMs }]
        } catch (error) {
          if (error.code === 'ENOENT') return []
          throw error
        }
      })
      .sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name))
    for (const file of files.slice(MAX_FILES)) {
      fs.rmSync(path.join(directory, file.name), { force: true })
    }
  }

  return {
    write(value) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      const bytes = Buffer.from(`${new Date().toISOString()} ${value}\n`)
      // A single oversized diagnostic keeps its beginning (error and initial stack frames).
      const bounded = bytes.subarray(0, MAX_FILE_BYTES)
      let size = 0
      try { size = fs.statSync(current).size } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (size + bounded.length > MAX_FILE_BYTES) {
        fs.rmSync(previous, { force: true })
        try { fs.renameSync(current, previous) } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }
      fs.appendFileSync(current, bounded, { mode: 0o600 })
      prune()
    },
  }
}

/** Install before application imports so bootstrap failures and Node warnings survive detachment. */
export function captureWorkerStderr(directory) {
  const diagnostics = createWorkerDiagnostics(directory)
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = function (chunk, encoding, callback) {
    try {
      diagnostics.write(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
    } catch (error) {
      originalWrite(`Unable to write worker diagnostics: ${error.message}\n`)
    }
    return originalWrite(chunk, encoding, callback)
  }
  // A monitor preserves Node's normal fatal-exit behavior and does not change job ownership.
  process.on('uncaughtExceptionMonitor', (error) => {
    try { diagnostics.write(error.stack ?? String(error)) } catch { /* stderr remains available */ }
  })
}
