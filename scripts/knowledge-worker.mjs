import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { captureWorkerStderr } from './worker-diagnostics.mjs'

const diagnosticDbArgument = process.argv.indexOf('--novel-db-path')
const diagnosticDbPath = process.env.RETALE_KNOWLEDGE_WORKER_NOVEL_DB_PATH
  || (diagnosticDbArgument >= 0 ? process.argv[diagnosticDbArgument + 1] : undefined)
if (diagnosticDbPath && !diagnosticDbPath.startsWith('--')) {
  captureWorkerStderr(path.join(path.dirname(path.resolve(diagnosticDbPath)), 'worker-logs'))
}

const SUPPORTED_JOB_TYPES = new Set(['extract_chapter_knowledge', 'rebuild_retrieval_index'])
const MAX_STARTUP_ERROR_LENGTH = 2000

function parseArgs(argv) {
  const options = {
    jobId: '',
    jobType: '',
    novelId: '',
    novelDbPath: '',
    lanceDbPath: '',
    branchId: '',
    attemptId: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const nextValue = argv[index + 1]
    if (!token.startsWith('--') || !nextValue || nextValue.startsWith('--')) {
      throw new Error(`Invalid argument near ${token}`)
    }

    switch (token) {
      case '--job-id':
        options.jobId = nextValue
        break
      case '--job-type':
        options.jobType = nextValue
        break
      case '--novel-id':
        options.novelId = nextValue
        break
      case '--novel-db-path':
        options.novelDbPath = nextValue
        break
      case '--lance-db-path':
        options.lanceDbPath = nextValue
        break
      case '--branch-id':
        options.branchId = nextValue
        break
      case '--attempt-id':
        options.attemptId = nextValue
        break
      default:
        throw new Error(`Unknown option: ${token}`)
    }

    index += 1
  }

  if (!options.jobId || !options.jobType || !options.novelId || !options.novelDbPath || !options.lanceDbPath || !options.branchId) {
    throw new Error('Usage: node scripts/knowledge-worker.mjs --job-id ID --job-type TYPE --novel-id ID --novel-db-path PATH --lance-db-path PATH --branch-id ID [--attempt-id ID]')
  }
  if (!SUPPORTED_JOB_TYPES.has(options.jobType)) {
    throw new Error(`Unsupported knowledge job type: ${options.jobType}`)
  }

  return options
}

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

function sanitizeStartupError(error) {
  const message = `Knowledge worker startup failed: ${formatError(error)}`
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
  return message.slice(0, MAX_STARTUP_ERROR_LENGTH)
}

async function persistStartupFailure(options, error) {
  const { DatabaseSync } = await import('node:sqlite')
  const database = new DatabaseSync(options.novelDbPath)
  try {
    database.prepare(
      `UPDATE KnowledgeJob
       SET status = 'failed', errorMessage = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND novelId = ? AND branchId = ? AND jobType = ? AND status = 'queued'
         AND json_extract(COALESCE(payloadJson, '{}'), '$.taskWatchdog.attemptId') IS ?`
    ).run(
      sanitizeStartupError(error),
      options.jobId,
      options.novelId,
      options.branchId,
      options.jobType,
      options.attemptId,
    )
  } finally {
    database.close()
  }
}

async function main(options) {
  process.env.RETALE_KNOWLEDGE_WORKER_NOVEL_ID = options.novelId
  process.env.RETALE_KNOWLEDGE_WORKER_NOVEL_DB_PATH = options.novelDbPath
  process.env.RETALE_KNOWLEDGE_WORKER_LANCEDB_DIR = options.lanceDbPath
  process.env.DATABASE_URL = `file:${options.novelDbPath}`
  process.env.LANCEDB_DIR = options.lanceDbPath
  let knowledgeRebuild
  if (process.env.NODE_ENV === 'production') {
    knowledgeRebuild = await import(pathToFileURL(path.join(process.cwd(), '.retale-worker', 'knowledge-worker-runtime.mjs')).href)
  } else {
    const { registerTypeScriptHooks } = await import('./typescript-runtime.mjs')
    await registerTypeScriptHooks()
    knowledgeRebuild = await import('@/lib/server/knowledge-rebuild')
  }

  if (options.jobType === 'extract_chapter_knowledge') {
    await knowledgeRebuild.runStartedKnowledgeRebuildForNovel({
      novelId: options.novelId,
      branchId: options.branchId,
      jobId: options.jobId,
      attemptId: options.attemptId,
    })
    return
  }

  if (options.jobType === 'rebuild_retrieval_index') {
    await knowledgeRebuild.runStartedKnowledgeRetrievalRebuildForNovel({
      novelId: options.novelId,
      branchId: options.branchId,
      jobId: options.jobId,
      attemptId: options.attemptId,
    })
  }
}

let options
try {
  options = parseArgs(process.argv.slice(2))
  await main(options)
} catch (error) {
  console.error(formatError(error))
  if (options) {
    try {
      await persistStartupFailure(options, error)
    } catch (fallbackError) {
      console.error(`Failed to persist knowledge worker startup error: ${formatError(fallbackError)}`)
    }
  }
  process.exitCode = 1
}
