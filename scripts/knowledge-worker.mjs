import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

const ROOT = process.cwd()
const SUPPORTED_JOB_TYPES = new Set(['extract_chapter_knowledge', 'rebuild_retrieval_index'])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const relativePath = specifier.slice(2)
      const candidates = [
        path.join(ROOT, `${relativePath}.ts`),
        path.join(ROOT, `${relativePath}.tsx`),
        path.join(ROOT, relativePath, 'index.ts'),
        path.join(ROOT, relativePath, 'index.tsx'),
      ]
      const match = candidates.find((candidate) => fs.existsSync(candidate))
      if (match) {
        return {
          shortCircuit: true,
          url: pathToFileURL(match).href,
        }
      }
    }

    return nextResolve(specifier, context)
  },
})

function parseArgs(argv) {
  const options = {
    jobId: '',
    jobType: '',
    novelId: '',
    novelDbPath: '',
    lanceDbPath: '',
    branchId: '',
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
      default:
        throw new Error(`Unknown option: ${token}`)
    }

    index += 1
  }

  if (!options.jobId || !options.jobType || !options.novelId || !options.novelDbPath || !options.lanceDbPath || !options.branchId) {
    throw new Error('Usage: node scripts/knowledge-worker.mjs --job-id ID --job-type TYPE --novel-id ID --novel-db-path PATH --lance-db-path PATH --branch-id ID')
  }
  if (!SUPPORTED_JOB_TYPES.has(options.jobType)) {
    throw new Error(`Unsupported knowledge job type: ${options.jobType}`)
  }

  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  process.env.RETALE_KNOWLEDGE_WORKER_NOVEL_ID = options.novelId
  process.env.RETALE_KNOWLEDGE_WORKER_NOVEL_DB_PATH = options.novelDbPath
  process.env.RETALE_KNOWLEDGE_WORKER_LANCEDB_DIR = options.lanceDbPath
  process.env.DATABASE_URL = `file:${options.novelDbPath}`
  process.env.LANCEDB_DIR = options.lanceDbPath
  const knowledgeRebuild = await import('@/lib/server/knowledge-rebuild')

  if (options.jobType === 'extract_chapter_knowledge') {
    await knowledgeRebuild.runStartedKnowledgeRebuildForNovel({
      novelId: options.novelId,
      branchId: options.branchId,
      jobId: options.jobId,
    })
    return
  }

  if (options.jobType === 'rebuild_retrieval_index') {
    await knowledgeRebuild.runStartedKnowledgeRetrievalRebuildForNovel({
      novelId: options.novelId,
      branchId: options.branchId,
      jobId: options.jobId,
    })
    return
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
