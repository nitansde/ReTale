import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { assertMaintenanceIdle } from './apply-storage-retention.mjs'
// Explicit offline conversion only; the application never imports this module.
import { progressZhMessages } from '../lib/i18n/progress-messages.ts'

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
const legacyPatterns = Object.entries(progressZhMessages).map(([key, template]) => {
    const names = [];
    let offset = 0;
    let pattern = '^';
    for (const match of template.matchAll(/\{\{(\w+)\}\}/gu)) {
        pattern += escapeRegex(template.slice(offset, match.index)) + '(.+?)';
        names.push(match[1]);
        offset = match.index + match[0].length;
    }
    pattern += escapeRegex(template.slice(offset)) + '$';
    return { key: key, names, regex: new RegExp(pattern, 'u') };
    // Prefer the more specific ETA template over a duration capturing its suffix.
}).sort((a, b) => b.names.length - a.names.length);

export function migrateProgressText(text) {
  if (typeof text !== 'string' || text.trim().startsWith('@retale-progress:')) return text
  for (const { key, names, regex } of legacyPatterns) {
    const match = regex.exec(text.trim())
    if (match) return '@retale-progress:' + JSON.stringify({key, values: Object.fromEntries(names.map((name, index) => [name, match[index+1]]))})
  }
  return text
}

export function migrateStoredProgress(database, { apply = true } = {}) {
  let changed = 0
  for (const row of database.prepare('SELECT id, jobType, currentStep, payloadJson FROM KnowledgeJob').all()) {
    const next = migrateProgressText(row.currentStep)
    let updated = false
    if (next !== row.currentStep) {
      if (apply) database.prepare('UPDATE KnowledgeJob SET currentStep = ? WHERE id = ?').run(next, row.id)
      updated = true
    }
    if (['extract_chapter_knowledge', 'rebuild_retrieval_index'].includes(row.jobType)) {
      let payload
      try { payload = JSON.parse(row.payloadJson) } catch { /* Preserve malformed diagnostics. */ }
      if (Array.isArray(payload?.steps)) {
        for (const [index, step] of payload.steps.entries()) {
          if (!step || typeof step !== 'object') continue
          for (const field of ['label', 'detail']) {
            const value = migrateProgressText(step[field])
            if (value !== step[field]) {
              if (apply) database.prepare('UPDATE KnowledgeJob SET payloadJson = json_set(payloadJson, ?, ?) WHERE id = ?')
                .run(`$.steps[${index}].${field}`, value, row.id)
              updated = true
            }
          }
        }
      }
    }
    if (updated) changed++
  }
  return changed
}

function main(args) {
  let databasePath, apply = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--database' && args[index+1]) databasePath = fs.realpathSync(args[++index])
    else if (args[index] === '--apply') apply = true
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`)
  }
  if (!databasePath) throw new Error('Usage: storage:migrate-progress -- --database PATH [--apply]. Stop the server and back up before applying.')
  const database = new DatabaseSync(databasePath, { readOnly: !apply })
  try {
    if (!apply) {
      console.log(JSON.stringify({ readOnly: true, candidateJobs: migrateStoredProgress(database, { apply: false }) }))
    } else {
      database.exec('BEGIN IMMEDIATE')
      try {
        assertMaintenanceIdle(database)
        const changedJobs = migrateStoredProgress(database)
        database.exec('COMMIT')
        console.log(JSON.stringify({ readOnly: false, changedJobs }))
      } catch (error) { database.exec('ROLLBACK'); throw error }
    }
  } finally { database.close() }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2))
