import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const ROOT = process.cwd()
const EVIDENCE_FILE = path.join(process.env.TASK_EVIDENCE_DIR || path.join(ROOT, '.sisyphus/evidence'), 'task-9-profiling.json')
const FIXED_EXTRACTION_UNIT_MS = 150
const FIXED_EMBEDDING_BATCH_MS = 60
const REQUIRED_RUN_METRICS = [
  'raw_text_embedding_precompute_ms',
  'raw_text_embedding_cache_hit_rate',
  'llm_extract_ms',
  'llm_write_ms',
  'final_index_build_ms',
  'total_rebuild_ms',
]

const fixtureArg = process.argv.includes('--fixture')
  ? process.argv[process.argv.indexOf('--fixture') + 1]
  : undefined
const modeArg = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : undefined

const fixtures = {
  standard: {
    id: 'standard',
    novelId: 'novel_profile_fixture',
    branchId: 'novel_profile_fixture:main',
    extractionUnits: 12,
    writeUnits: 4,
    rawTextDocs: 16,
    knowledgeDerivedDocs: 20,
    staleCacheRows: 1,
    runOverrides: {},
  },
  regression: {
    id: 'regression',
    novelId: 'novel_profile_regression_fixture',
    branchId: 'novel_profile_regression_fixture:main',
    extractionUnits: 12,
    writeUnits: 4,
    rawTextDocs: 16,
    knowledgeDerivedDocs: 20,
    staleCacheRows: 1,
    runOverrides: {
      warm: {
        omitMetrics: ['raw_text_embedding_cache_hit_rate'],
      },
    },
  },
  'regression-cache-hit': {
    id: 'regression-cache-hit',
    novelId: 'novel_profile_regression_cache_hit_fixture',
    branchId: 'novel_profile_regression_cache_hit_fixture:main',
    extractionUnits: 12,
    writeUnits: 4,
    rawTextDocs: 16,
    knowledgeDerivedDocs: 20,
    staleCacheRows: 1,
    runOverrides: {
      cold: {
        metricOverrides: {
          raw_text_embedding_cache_hit_rate: 0.5,
        },
      },
      warm: {
        metricOverrides: {
          raw_text_embedding_cache_hit_rate: 0.5,
        },
      },
    },
  },
  'regression-slowdown': {
    id: 'regression-slowdown',
    novelId: 'novel_profile_regression_slowdown_fixture',
    branchId: 'novel_profile_regression_slowdown_fixture:main',
    extractionUnits: 12,
    writeUnits: 4,
    rawTextDocs: 16,
    knowledgeDerivedDocs: 20,
    staleCacheRows: 1,
    runOverrides: {
      warm: {
        timingOverrides: {
          raw_text_embedding_precompute_ms: 200,
          total_rebuild_ms: 3200,
        },
      },
    },
  },
}

if (!fixtures[fixtureArg] || modeArg !== 'compare') {
  console.error(
    'Usage: node scripts/profile-knowledge-rebuild.mjs --fixture <standard|regression|regression-cache-hit|regression-slowdown> --mode compare',
  )
  process.exit(1)
}

const fixture = fixtures[fixtureArg]

const embeddingSettingsSnapshot = {
  provider: 'openai-compatible',
  model: 'text-embedding-3-small',
  embeddingBatchSize: 4,
}

const batchSize = Math.max(1, Math.floor(embeddingSettingsSnapshot.embeddingBatchSize || 1))
const cacheState = new Map()

function buildRawTextFixtureDocs() {
  return Array.from({ length: fixture.rawTextDocs }, (_, index) => ({
    id: `raw-text-${index + 1}`,
    chapterNo: index + 1,
    text: `Raw text fixture paragraph ${index + 1}`,
  }))
}

function buildKnowledgeFixtureDocs() {
  return Array.from({ length: fixture.knowledgeDerivedDocs }, (_, index) => ({
    id: `knowledge-${index + 1}`,
    chapterNo: index + 1,
    text: `Knowledge-derived fixture doc ${index + 1}`,
  }))
}

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex')
}

function buildCacheKey(text) {
  return hashValue([
    fixture.branchId,
    embeddingSettingsSnapshot.provider,
    embeddingSettingsSnapshot.model,
    text,
  ].join('::'))
}

function seedInitialStaleCacheRows(rawTextDocs) {
  for (let index = 0; index < fixture.staleCacheRows; index += 1) {
    cacheState.set(buildCacheKey(`${rawTextDocs[0]?.text ?? 'raw-text'}::stale-${index}`), {
      vectorDimension: 3,
      stale: true,
    })
  }
}

function applyRunOverrides(run, overrides = {}) {
  const nextRun = {
    ...run,
    deterministic_timing: {
      ...run.deterministic_timing,
      ...(overrides.deterministicTimingOverrides || {}),
    },
  }

  if (overrides.metricOverrides) {
    Object.assign(nextRun, overrides.metricOverrides)
  }

  if (overrides.timingOverrides) {
    Object.assign(nextRun, overrides.timingOverrides)
  }

  for (const metricName of overrides.omitMetrics || []) {
    delete nextRun[metricName]
  }

  return nextRun
}

function runDeterministicPass(label) {
  const rawTextDocs = buildRawTextFixtureDocs()
  const knowledgeDocs = buildKnowledgeFixtureDocs()
  const reachableHashes = rawTextDocs.map((doc) => buildCacheKey(doc.text))
  const rawTextCacheHits = reachableHashes.filter((hash) => cacheState.has(hash)).length
  const rawTextCacheMisses = rawTextDocs.length - rawTextCacheHits
  const precomputeEmbeddingBatches = rawTextCacheMisses === 0 ? 0 : Math.ceil(rawTextCacheMisses / batchSize)
  const rawTextEmbeddingPrecomputeMs = precomputeEmbeddingBatches * FIXED_EMBEDDING_BATCH_MS
  const llmExtractMs = fixture.extractionUnits * FIXED_EXTRACTION_UNIT_MS
  const llmWriteMs = fixture.writeUnits * FIXED_EXTRACTION_UNIT_MS

  for (const hash of reachableHashes) {
    cacheState.set(hash, { vectorDimension: 3, stale: false })
  }

  let gcDeletedRows = 0
  for (const cacheKey of Array.from(cacheState.keys())) {
    if (!reachableHashes.includes(cacheKey)) {
      cacheState.delete(cacheKey)
      gcDeletedRows += 1
    }
  }

  const finalRawTextLiveEmbeds = rawTextDocs.filter((doc) => !cacheState.has(buildCacheKey(doc.text))).length
  const finalKnowledgeLiveEmbeds = knowledgeDocs.length
  const finalLiveEmbeds = finalRawTextLiveEmbeds + finalKnowledgeLiveEmbeds
  const finalIndexBatches = finalLiveEmbeds === 0 ? 0 : Math.ceil(finalLiveEmbeds / batchSize)
  const finalIndexBuildMs = finalIndexBatches * FIXED_EMBEDDING_BATCH_MS
  const totalRebuildMs = rawTextEmbeddingPrecomputeMs + llmExtractMs + llmWriteMs + finalIndexBuildMs

  const run = {
    label,
    fixture: fixture.id,
    embeddingSettingsSnapshot,
    raw_text_embedding_precompute_ms: rawTextEmbeddingPrecomputeMs,
    raw_text_embedding_cache_hit_rate: fixture.rawTextDocs > 0 ? rawTextCacheHits / fixture.rawTextDocs : 1,
    llm_extract_ms: llmExtractMs,
    llm_write_ms: llmWriteMs,
    final_index_build_ms: finalIndexBuildMs,
    total_rebuild_ms: totalRebuildMs,
    deterministic_timing: {
      extraction_unit_ms: FIXED_EXTRACTION_UNIT_MS,
      embedding_batch_ms: FIXED_EMBEDDING_BATCH_MS,
      total_raw_text_docs: rawTextDocs.length,
      total_knowledge_docs: knowledgeDocs.length,
      precompute_embedding_batches: precomputeEmbeddingBatches,
      final_index_embedding_batches: finalIndexBatches,
      precompute_embedded_docs: rawTextCacheMisses,
      final_raw_text_live_embeds: finalRawTextLiveEmbeds,
      final_knowledge_live_embeds: finalKnowledgeLiveEmbeds,
      gc_deleted_rows: gcDeletedRows,
    },
  }

  return applyRunOverrides(run, fixture.runOverrides?.[label])
}

function buildComparison(coldRun, warmRun) {
  return {
    raw_text_embedding_precompute_ms_delta:
      warmRun.raw_text_embedding_precompute_ms - coldRun.raw_text_embedding_precompute_ms,
    raw_text_embedding_cache_hit_rate_delta:
      warmRun.raw_text_embedding_cache_hit_rate - coldRun.raw_text_embedding_cache_hit_rate,
    llm_extract_ms_delta: warmRun.llm_extract_ms - coldRun.llm_extract_ms,
    llm_write_ms_delta: warmRun.llm_write_ms - coldRun.llm_write_ms,
    final_index_build_ms_delta: warmRun.final_index_build_ms - coldRun.final_index_build_ms,
    total_rebuild_ms_delta: warmRun.total_rebuild_ms - coldRun.total_rebuild_ms,
  }
}

function validateCompareArtifact(artifact) {
  const coldRun = artifact.runs?.cold
  const warmRun = artifact.runs?.warm

  for (const [label, run] of [
    ['cold', coldRun],
    ['warm', warmRun],
  ]) {
    for (const metricName of REQUIRED_RUN_METRICS) {
      if (typeof run?.[metricName] !== 'number' || !Number.isFinite(run[metricName])) {
        throw new Error(`Profiling regression: missing required metric "${label}.${metricName}".`)
      }
    }
  }

  if (!(warmRun.raw_text_embedding_cache_hit_rate > coldRun.raw_text_embedding_cache_hit_rate)) {
    throw new Error(
      `Profiling regression: warm raw_text_embedding_cache_hit_rate ${warmRun.raw_text_embedding_cache_hit_rate} was not higher than cold ${coldRun.raw_text_embedding_cache_hit_rate}.`,
    )
  }

  const allowedWarmTotalMs = coldRun.total_rebuild_ms * 1.05

  if (warmRun.total_rebuild_ms > allowedWarmTotalMs) {
    throw new Error(
      `Profiling regression: warm total_rebuild_ms ${warmRun.total_rebuild_ms} exceeded 5% slowdown threshold ${allowedWarmTotalMs} against cold ${coldRun.total_rebuild_ms}.`,
    )
  }
}

seedInitialStaleCacheRows(buildRawTextFixtureDocs())

const coldRun = runDeterministicPass('cold')
const warmRun = runDeterministicPass('warm')

const artifact = {
  task: 'task-9-profiling',
  command: `node scripts/profile-knowledge-rebuild.mjs --fixture ${fixture.id} --mode compare`,
  generatedAt: new Date().toISOString(),
  fixture: fixture.id,
  mode: 'compare',
  embeddingSettingsSnapshot,
  runs: {
    cold: coldRun,
    warm: warmRun,
  },
  comparison: buildComparison(coldRun, warmRun),
}

fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true })
fs.writeFileSync(EVIDENCE_FILE, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')

try {
  validateCompareArtifact(artifact)
  console.log(`Wrote deterministic profiling artifact: ${EVIDENCE_FILE}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
