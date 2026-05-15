import { hashContent, normalizeBranchId } from '@/lib/server/knowledge-store'
import { execute, queryAll, withTransaction } from '@/lib/server/sqlite'

export type RawTextEmbeddingCacheScope = {
  novelId: string
  branchId?: string | null
  provider: string
  model: string
}

export type RetrievalEmbeddingInputParts = {
  sourceLabel?: string | null
  title?: string | null
  relatedEntityNames?: string | null
  relatedEventNames?: string | null
  relatedTerms?: string | null
  text: string
}

export type RawTextEmbeddingCacheUpsertEntry = {
  embeddingInput: string
  vector: number[]
}

export type RawTextEmbeddingCacheEntry = {
  branchId: string
  provider: string
  model: string
  embeddingInputHash: string
  vector: number[]
  vectorDimension: number
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

type RawTextEmbeddingCacheRow = {
  branchId: string
  provider: string
  model: string
  embeddingInputHash: string
  vectorJson: string
  vectorDimension: number
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

function requireTrimmedValue(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function normalizeScope(scope: RawTextEmbeddingCacheScope) {
  return {
    branchId: normalizeBranchId(scope.novelId, scope.branchId),
    provider: requireTrimmedValue(scope.provider, 'Embedding provider'),
    model: requireTrimmedValue(scope.model, 'Embedding model'),
  }
}

function uniqueNonEmptyHashes(embeddingInputHashes: string[]) {
  return Array.from(new Set(embeddingInputHashes.map((hash) => hash.trim()).filter(Boolean)))
}

function validateVector(vector: number[], expectedDimension?: number) {
  if (!Array.isArray(vector) || !vector.length) {
    throw new Error('Embedding vector must be a non-empty array')
  }

  const normalized = vector.map((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding vector contains a non-finite value at index ${index}`)
    }
    return value
  })

  if (expectedDimension !== undefined && normalized.length !== expectedDimension) {
    throw new Error(`Embedding vectors in the same batch must share one dimension; expected ${expectedDimension} but received ${normalized.length}`)
  }

  return normalized
}

function parseStoredVector(row: RawTextEmbeddingCacheRow) {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.vectorJson)
  } catch {
    throw new Error('Stored embedding vector is not valid JSON')
  }

  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error('Stored embedding vector must be a non-empty array')
  }

  const vector = parsed.map((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Stored embedding vector contains a non-finite value at index ${index}`)
    }
    return value
  })

  if (!Number.isInteger(row.vectorDimension) || row.vectorDimension <= 0) {
    throw new Error('Stored embedding vector dimension must be a positive integer')
  }

  if (vector.length !== row.vectorDimension) {
    throw new Error(`Stored embedding vector dimension mismatch: expected ${row.vectorDimension} but received ${vector.length}`)
  }

  return vector
}

function buildPlaceholders(count: number) {
  return Array.from({ length: count }, () => '?').join(', ')
}

export function buildCanonicalRetrievalEmbeddingInput(parts: RetrievalEmbeddingInputParts) {
  return [
    parts.sourceLabel ?? '',
    parts.title ?? '',
    (parts.relatedEntityNames ?? '').replace(/\n/g, ' '),
    (parts.relatedEventNames ?? '').replace(/\n/g, ' '),
    (parts.relatedTerms ?? '').replace(/\n/g, ' '),
    parts.text,
  ].filter(Boolean).join('\n')
}

export function buildEmbeddingInputHash(embeddingInput: string) {
  return hashContent(embeddingInput)
}

export async function lookupRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  embeddingInputHashes: string[]
  touchOnHit?: boolean
}) {
  const hashes = uniqueNonEmptyHashes(params.embeddingInputHashes)
  if (!hashes.length) {
    return [] as RawTextEmbeddingCacheEntry[]
  }

  const scope = normalizeScope(params.scope)
  const rows = queryAll<RawTextEmbeddingCacheRow>(
    `
      SELECT branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension, lastSeenAt, createdAt, updatedAt
      FROM RawTextEmbeddingCache
      WHERE branchId = ?
        AND provider = ?
        AND model = ?
        AND embeddingInputHash IN (${buildPlaceholders(hashes.length)})
    `,
    scope.branchId,
    scope.provider,
    scope.model,
    ...hashes,
  )

  const invalidHashes: string[] = []
  const validEntries = new Map<string, RawTextEmbeddingCacheEntry>()

  for (const row of rows) {
    try {
      validEntries.set(row.embeddingInputHash, {
        branchId: row.branchId,
        provider: row.provider,
        model: row.model,
        embeddingInputHash: row.embeddingInputHash,
        vector: parseStoredVector(row),
        vectorDimension: row.vectorDimension,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    } catch {
      invalidHashes.push(row.embeddingInputHash)
    }
  }

  if (invalidHashes.length) {
    const invalidPlaceholders = buildPlaceholders(invalidHashes.length)
    await withTransaction(() => {
      execute(
        `
          DELETE FROM RawTextEmbeddingCache
          WHERE branchId = ?
            AND provider = ?
            AND model = ?
            AND embeddingInputHash IN (${invalidPlaceholders})
        `,
        scope.branchId,
        scope.provider,
        scope.model,
        ...invalidHashes,
      )
    })
  }

  const matchedHashes = hashes.filter((hash) => validEntries.has(hash))
  if (params.touchOnHit && matchedHashes.length) {
    const touchPlaceholders = buildPlaceholders(matchedHashes.length)
    await withTransaction(() => {
      execute(
        `
          UPDATE RawTextEmbeddingCache
          SET lastSeenAt = CURRENT_TIMESTAMP,
              updatedAt = CURRENT_TIMESTAMP
          WHERE branchId = ?
            AND provider = ?
            AND model = ?
            AND embeddingInputHash IN (${touchPlaceholders})
        `,
        scope.branchId,
        scope.provider,
        scope.model,
        ...matchedHashes,
      )
    })
  }

  return hashes.map((hash) => validEntries.get(hash)).filter((entry): entry is RawTextEmbeddingCacheEntry => Boolean(entry))
}

export async function upsertRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  entries: RawTextEmbeddingCacheUpsertEntry[]
}) {
  if (!params.entries.length) {
    return 0
  }

  const scope = normalizeScope(params.scope)
  let expectedDimension: number | undefined
  const dedupedEntries = new Map<string, { vector: number[] }>()

  for (const entry of params.entries) {
    const embeddingInput = requireTrimmedValue(entry.embeddingInput, 'Embedding input')
    const vector = validateVector(entry.vector, expectedDimension)
    expectedDimension ??= vector.length
    dedupedEntries.set(buildEmbeddingInputHash(embeddingInput), { vector })
  }

  await withTransaction(() => {
    for (const [embeddingInputHash, entry] of dedupedEntries) {
      execute(
        `
          INSERT INTO RawTextEmbeddingCache (
            branchId,
            provider,
            model,
            embeddingInputHash,
            vectorJson,
            vectorDimension,
            lastSeenAt,
            createdAt,
            updatedAt
          )
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(branchId, provider, model, embeddingInputHash) DO UPDATE SET
            vectorJson = excluded.vectorJson,
            vectorDimension = excluded.vectorDimension,
            lastSeenAt = CURRENT_TIMESTAMP,
            updatedAt = CURRENT_TIMESTAMP
        `,
        scope.branchId,
        scope.provider,
        scope.model,
        embeddingInputHash,
        JSON.stringify(entry.vector),
        entry.vector.length,
      )
    }
  })

  return dedupedEntries.size
}

export async function deleteRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  embeddingInputHashes: string[]
}) {
  const hashes = uniqueNonEmptyHashes(params.embeddingInputHashes)
  if (!hashes.length) {
    return 0
  }

  const scope = normalizeScope(params.scope)
  const result = execute(
    `
      DELETE FROM RawTextEmbeddingCache
      WHERE branchId = ?
        AND provider = ?
        AND model = ?
        AND embeddingInputHash IN (${buildPlaceholders(hashes.length)})
    `,
    scope.branchId,
    scope.provider,
    scope.model,
    ...hashes,
  )

  return Number(result.changes ?? 0)
}

export async function garbageCollectRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  reachableEmbeddingInputHashes: string[]
}) {
  const scope = normalizeScope(params.scope)
  const hashes = uniqueNonEmptyHashes(params.reachableEmbeddingInputHashes)

  if (!hashes.length) {
    const result = execute(
      `
        DELETE FROM RawTextEmbeddingCache
        WHERE branchId = ?
          AND provider = ?
          AND model = ?
      `,
      scope.branchId,
      scope.provider,
      scope.model,
    )
    return Number(result.changes ?? 0)
  }

  const result = execute(
    `
      DELETE FROM RawTextEmbeddingCache
      WHERE branchId = ?
        AND provider = ?
        AND model = ?
        AND embeddingInputHash NOT IN (${buildPlaceholders(hashes.length)})
    `,
    scope.branchId,
    scope.provider,
    scope.model,
    ...hashes,
  )

  return Number(result.changes ?? 0)
}
