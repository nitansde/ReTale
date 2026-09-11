import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createMaintenanceReader } from './apply-storage-retention.mjs'
import { countChineseFriendlyWords, htmlToPlainText } from '../lib/utils.ts'
import {
  previewEmbeddingCacheRetention,
  previewWorkspaceBackupRetention,
  readStorageRetentionPolicy,
} from '../lib/server/storage-retention.ts'

function fileBytes(file) {
  try { return fs.statSync(file).size } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }
}

function previewDerivedText(database) {
  const affected = []
  let chapterCount = 0
  const chapters = database.prepare(`
    SELECT chapter.id, chapter.novelId, chapter.parentChapterId, chapter.contentHtml,
      chapter.wordCount, knowledge.rawText, knowledge.chapterNo
    FROM WorkspaceRuntimeChapter chapter
    LEFT JOIN KnowledgeChapter knowledge ON knowledge.id = chapter.id
      AND knowledge.novelId = chapter.novelId AND knowledge.branchId = chapter.novelId || ':main'
    ORDER BY chapter.novelId, chapter.sortOrder, chapter.id
  `)
  for (const chapter of chapters.iterate()) {
    chapterCount += 1
    const rawText = htmlToPlainText(chapter.contentHtml)
    const wordCount = countChineseFriendlyWords(rawText)
    const rawTextMismatch = !chapter.parentChapterId && chapter.rawText !== null && rawText !== chapter.rawText
    if (rawTextMismatch || wordCount !== chapter.wordCount) {
      affected.push({
        chapterId: chapter.id,
        novelId: chapter.novelId,
        chapterNo: chapter.chapterNo,
        rawTextMismatch,
        storedWordCount: chapter.wordCount,
        derivedWordCount: wordCount,
        hasEncodedEntities: /&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/.test(chapter.contentHtml),
      })
    }
  }
  return { source: 'WorkspaceRuntimeChapter.contentHtml', chapterCount, affected }
}

/** Read-only audit: never initializes schema, writes data, checkpoints, or vacuums. */
export function previewStorageMaintenance(databasePath, currentIdentities = []) {
  const resolvedPath = fs.realpathSync(databasePath)
  const database = new DatabaseSync(resolvedPath, { readOnly: true })
  try {
    database.exec('PRAGMA query_only = ON; BEGIN')
    const db = createMaintenanceReader(database)
    const policy = readStorageRetentionPolicy()
    // Without an explicitly supplied current identity, conservatively protect
    // every cache model. The report lists those identities for inspection.
    const identities = currentIdentities.length ? currentIdentities : db.queryAll(
      'SELECT DISTINCT provider, model FROM RawTextEmbeddingCache',
    )
    const backups = db.queryAll('SELECT id FROM WorkspaceState')
      .map(({ id }) => previewWorkspaceBackupRetention(db, id, policy))
    const caches = db.queryAll('SELECT id FROM NovelRecord')
      .map(({ id }) => previewEmbeddingCacheRetention(db, id, identities, policy))
    const pageSize = database.prepare('PRAGMA page_size').get().page_size
    const reusablePages = database.prepare('PRAGMA freelist_count').get().freelist_count
    return {
      databasePath: resolvedPath,
      readOnly: true,
      policy,
      disk: {
        databaseBytes: fileBytes(resolvedPath),
        walBytes: fileBytes(`${resolvedPath}-wal`),
        reusableBytes: reusablePages * pageSize,
        autoVacuum: database.prepare('PRAGMA auto_vacuum').get().auto_vacuum,
        physicalBytesReclaimedByThisPreview: 0,
      },
      cacheIdentityProtection: currentIdentities.length ? 'explicit-current-identities-plus-jobs' : 'all-identities-no-current-model-supplied',
      backups,
      caches,
      derivedText: previewDerivedText(database),
    }
  } finally {
    database.close()
  }
}

function main(args) {
  const { loadEnvConfig } = createRequire(import.meta.url)('@next/env')
  loadEnvConfig(process.cwd(), true)
  let databasePath
  const currentIdentities = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--database' && args[index + 1]) {
      databasePath = path.resolve(args[++index])
    } else if (args[index] === '--protect-model' && args[index + 1]) {
      const identity = args[++index]
      const separator = identity.indexOf('=')
      if (separator <= 0 || separator === identity.length - 1) throw new Error('--protect-model requires provider=exact-cache-model-identity')
      currentIdentities.push({ provider: identity.slice(0, separator), model: identity.slice(separator + 1) })
    } else {
      throw new Error(`Unknown or incomplete argument: ${args[index]}`)
    }
  }
  if (!databasePath) throw new Error('Usage: npm run storage:preview -- --database PATH [--protect-model provider=exact-cache-model-identity]')
  console.log(JSON.stringify(previewStorageMaintenance(databasePath, currentIdentities), null, 2))
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2))
}
