// Explicit offline conversion only; the application never imports this module.
import { decodeEmbeddingVector, encodeEmbeddingVector } from '../lib/server/embedding-vector.ts'

// Caller owns an offline write transaction. Validate every retained row before
// removing its previous representation; a failure leaves the old table intact.
export function finalizeEmbeddingVectorMigration(database) {
    const columns = database.prepare('PRAGMA table_info(RawTextEmbeddingCache)').all();
    if (!columns.some(column => column.name === 'vectorBlob')) throw new Error('Backfill vectors before finalizing');
    const hasJson = columns.some(column => column.name === 'vectorJson');
    if (hasJson && database.prepare("SELECT 1 FROM RawTextEmbeddingCache WHERE vectorJson != '[]' LIMIT 1").get()) {
        throw new Error('Retire every JSON vector before finalizing the database');
    }
    let validated = 0;
    for (const row of database.prepare('SELECT vectorBlob, vectorDimension FROM RawTextEmbeddingCache').iterate()) {
        if (!(row.vectorBlob instanceof Uint8Array)) throw new Error('Missing binary vector');
        decodeEmbeddingVector(row.vectorBlob, row.vectorDimension);
        validated++;
    }
    if (!hasJson && columns.find(column => column.name === 'vectorBlob')?.notnull === 1) {
        return { finalized: false, validated };
    }
    const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'RawTextEmbeddingCache' AND sql IS NOT NULL").all();
    const triggers = database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'RawTextEmbeddingCache' AND name != 'trg_raw_text_embedding_legacy_write'").all();
    if (triggers.length) throw new Error('Unexpected cache triggers; inspect before finalizing');
    database.exec(`
      CREATE TABLE RawTextEmbeddingCache_binary (
        branchId TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        embeddingInputHash TEXT NOT NULL,
        vectorBlob BLOB NOT NULL,
        vectorDimension INTEGER NOT NULL,
        lastSeenAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (branchId, provider, model, embeddingInputHash),
        FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE
      );
      INSERT INTO RawTextEmbeddingCache_binary
        SELECT branchId, provider, model, embeddingInputHash, vectorBlob, vectorDimension, lastSeenAt, createdAt, updatedAt
        FROM RawTextEmbeddingCache;
      DROP TABLE RawTextEmbeddingCache;
      ALTER TABLE RawTextEmbeddingCache_binary RENAME TO RawTextEmbeddingCache;
    `);
    for (const { sql } of indexes) database.exec(sql);
    return { finalized: true, validated };
}

export function parseJsonEmbeddingVector(json, dimension) {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || !Number.isSafeInteger(dimension) || dimension <= 0 || parsed.length !== dimension) {
        throw new Error('Stored embedding vector dimension mismatch');
    }
    if (parsed.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error('Stored embedding vector contains a non-finite value');
    }
    return parsed;
}
// Caller owns the transaction. Cursor advances past invalid rows; those retain
// their JSON and are reported for repair rather than silently discarding data.
export function backfillEmbeddingVectorBatch(database, params) {
    const limit = params.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        throw new Error('Batch limit must be between 1 and 1000');
    const afterRowId = params.afterRowId ?? 0;
    if (!Number.isSafeInteger(afterRowId) || afterRowId < 0)
        throw new Error('Invalid migration cursor');
    const rows = database.prepare(`
    SELECT cache.rowid AS rowId, cache.vectorJson, cache.vectorBlob, cache.vectorDimension
    FROM RawTextEmbeddingCache cache JOIN StoryBranch branch ON branch.id = cache.branchId
    WHERE branch.novelId = ? AND cache.rowid > ?
      AND (cache.vectorBlob IS NULL OR (? = 1 AND cache.vectorJson != '[]'))
    ORDER BY cache.rowid LIMIT ?
  `).all(params.novelId, afterRowId, params.retireJson ? 1 : 0, limit);
    let converted = 0;
    let retired = 0;
    const errors = [];
    for (const row of rows) {
        let bytes;
        try {
            const legacy = parseJsonEmbeddingVector(row.vectorJson, row.vectorDimension);
            bytes = row.vectorBlob ?? encodeEmbeddingVector(legacy);
            const decoded = decodeEmbeddingVector(bytes, row.vectorDimension);
            if (decoded.some((value, index) => !Object.is(value, Math.fround(legacy[index])))) {
                throw new Error('Binary vector differs from float32 JSON values; JSON retained');
            }
        }
        catch (error) {
            errors.push({ rowId: row.rowId, error: error instanceof Error ? error.message : 'Invalid vector' });
            continue;
        }
        database.prepare('UPDATE RawTextEmbeddingCache SET vectorBlob = ? WHERE rowid = ?').run(bytes, row.rowId);
        // Verify the bytes actually stored before the optional retirement step.
        const stored = database.prepare('SELECT vectorBlob FROM RawTextEmbeddingCache WHERE rowid = ?').get(row.rowId);
        if (!stored || stored.vectorBlob.length !== bytes.length || stored.vectorBlob.some((value, index) => value !== bytes[index])) {
            throw new Error('Embedding BLOB verification failed');
        }
        if (!row.vectorBlob)
            converted += 1;
        if (params.retireJson) {
            database.prepare("UPDATE RawTextEmbeddingCache SET vectorJson = '[]' WHERE rowid = ?").run(row.rowId);
            retired += 1;
        }
    }
    return { scanned: rows.length, converted, retired, errors, nextRowId: rows.at(-1)?.rowId ?? afterRowId };
}
