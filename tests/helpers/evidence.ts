import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DEFAULT_EVIDENCE_DIR = path.join(ROOT, '.sisyphus/evidence/task-1-test-harness')

export function ensureEvidenceDir(subdirectory?: string) {
  const targetDirectory = subdirectory
    ? path.join(process.env.TASK_EVIDENCE_DIR ?? DEFAULT_EVIDENCE_DIR, subdirectory)
    : process.env.TASK_EVIDENCE_DIR ?? DEFAULT_EVIDENCE_DIR

  fs.mkdirSync(targetDirectory, { recursive: true })
  return targetDirectory
}

export function writeEvidenceFile(relativePath: string, content: string) {
  const targetPath = path.join(process.env.TASK_EVIDENCE_DIR ?? DEFAULT_EVIDENCE_DIR, relativePath)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, content)
  return targetPath
}
