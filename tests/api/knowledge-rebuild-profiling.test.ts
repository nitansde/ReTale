import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { mergeKnowledgeRebuildTelemetryPayloadForTesting } from '@/lib/server/knowledge-rebuild'

describe('knowledge rebuild payload profiling telemetry', () => {
  const root = process.cwd()
  const artifactPath = path.join(root, '.sisyphus/evidence/task-9-profiling.json')

  it('records rebuild timing fields in payload', () => {
    const basePayload = {
      branchId: 'novel_telemetry:main',
      phase: 'extract' as const,
      pendingChapterIds: ['ch_1'],
      chapterWeightsById: { ch_1: 120 },
      totalChapterWeight: 120,
      processedChapterWeight: 0,
      extractedChapters: [],
    }

    const payload = mergeKnowledgeRebuildTelemetryPayloadForTesting(basePayload, {
      rawTextEmbeddingProgress: 0.35,
      rawTextEmbeddingCacheHitRate: 0.8,
      stageTimingsMs: {
        extract: 1300,
        raw_text_precompute: 420,
      },
    })

    expect(payload.rawTextEmbeddingProgress).toBe(0.35)
    expect(payload.rawTextEmbeddingCacheHitRate).toBe(0.8)
    expect(payload.stageTimingsMs).toMatchObject({
      extract: 1300,
      raw_text_precompute: 420,
    })
    expect(payload.embeddingSettingsSnapshot).toMatchObject({
      provider: expect.any(String),
      model: expect.any(String),
      embeddingBatchSize: expect.any(Number),
    })
  })

  it('preserves unrelated payload state on partial telemetry updates', () => {
    const basePayload = {
      branchId: 'novel_telemetry:main',
      phase: 'write' as const,
      currentChapterId: 'ch_2',
      pendingChapterIds: ['ch_2', 'ch_3'],
      chapterWeightsById: { ch_2: 88, ch_3: 144 },
      totalChapterWeight: 232,
      processedChapterWeight: 88,
      extractedChapters: [{ chapterId: 'ch_2', chapterNo: 2 }],
      totalChapterCount: 2,
      inlineCleanupCompleted: true,
      stageTimingsMs: { extract: 500 },
    }

    const firstUpdate = mergeKnowledgeRebuildTelemetryPayloadForTesting(basePayload, {
      stageTimingsMs: { write: 300 },
    })
    const secondUpdate = mergeKnowledgeRebuildTelemetryPayloadForTesting(firstUpdate, {
      rawTextEmbeddingCacheHitRate: 0.6,
    })

    expect(secondUpdate.phase).toBe('write')
    expect(secondUpdate.currentChapterId).toBe('ch_2')
    expect(secondUpdate.pendingChapterIds).toEqual(['ch_2', 'ch_3'])
    expect(secondUpdate.chapterWeightsById).toEqual({ ch_2: 88, ch_3: 144 })
    expect(secondUpdate.totalChapterWeight).toBe(232)
    expect(secondUpdate.processedChapterWeight).toBe(88)
    expect(secondUpdate.extractedChapters).toEqual([{ chapterId: 'ch_2', chapterNo: 2 }])
    expect(secondUpdate.inlineCleanupCompleted).toBe(true)
    expect(secondUpdate.stageTimingsMs).toMatchObject({ extract: 500, write: 300 })
    expect(secondUpdate.rawTextEmbeddingCacheHitRate).toBe(0.6)
  })

  it('writes cold and warm profiling metrics to one artifact', () => {
    if (fs.existsSync(artifactPath)) {
      fs.unlinkSync(artifactPath)
    }

    const run = spawnSync(
      'node',
      ['scripts/profile-knowledge-rebuild.mjs', '--fixture', 'standard', '--mode', 'compare'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )

    expect(run.status).toBe(0)
    expect(fs.existsSync(artifactPath)).toBe(true)

    const parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
      mode: string
      fixture: string
      runs: {
        cold: {
          embeddingSettingsSnapshot: Record<string, unknown>
          raw_text_embedding_precompute_ms: number
          raw_text_embedding_cache_hit_rate: number
          llm_extract_ms: number
          llm_write_ms: number
          final_index_build_ms: number
          total_rebuild_ms: number
          deterministic_timing: Record<string, number>
        }
        warm: {
          embeddingSettingsSnapshot: Record<string, unknown>
          raw_text_embedding_precompute_ms: number
          raw_text_embedding_cache_hit_rate: number
          llm_extract_ms: number
          llm_write_ms: number
          final_index_build_ms: number
          total_rebuild_ms: number
          deterministic_timing: Record<string, number>
        }
      }
      embeddingSettingsSnapshot: Record<string, unknown>
    }

    expect(parsed.mode).toBe('compare')
    expect(parsed.fixture).toBe('standard')
    expect(parsed.embeddingSettingsSnapshot).toEqual(parsed.runs.cold.embeddingSettingsSnapshot)
    expect(parsed.embeddingSettingsSnapshot).toEqual(parsed.runs.warm.embeddingSettingsSnapshot)

    expect(parsed.runs.cold).toMatchObject({
      raw_text_embedding_precompute_ms: expect.any(Number),
      raw_text_embedding_cache_hit_rate: expect.any(Number),
      llm_extract_ms: expect.any(Number),
      llm_write_ms: expect.any(Number),
      final_index_build_ms: expect.any(Number),
      total_rebuild_ms: expect.any(Number),
    })

    expect(parsed.runs.warm).toMatchObject({
      raw_text_embedding_precompute_ms: expect.any(Number),
      raw_text_embedding_cache_hit_rate: expect.any(Number),
      llm_extract_ms: expect.any(Number),
      llm_write_ms: expect.any(Number),
      final_index_build_ms: expect.any(Number),
      total_rebuild_ms: expect.any(Number),
    })

    expect(parsed.runs.cold.raw_text_embedding_cache_hit_rate).toBe(0)
    expect(parsed.runs.warm.raw_text_embedding_cache_hit_rate).toBe(1)
    expect(parsed.runs.warm.raw_text_embedding_precompute_ms).toBe(0)
    expect(parsed.runs.warm.total_rebuild_ms).toBeLessThan(parsed.runs.cold.total_rebuild_ms)
    expect(parsed.runs.cold.deterministic_timing.gc_deleted_rows).toBe(1)
    expect(parsed.runs.warm.deterministic_timing.gc_deleted_rows).toBe(0)
    expect(parsed.runs.cold.deterministic_timing.final_raw_text_live_embeds).toBe(0)
    expect(parsed.runs.warm.deterministic_timing.final_raw_text_live_embeds).toBe(0)
    expect(parsed.runs.cold.deterministic_timing.final_knowledge_live_embeds).toBeGreaterThan(0)
  })

  it('fails profiling compare on missing metrics or warm-run regression', () => {
    const cases = [
      {
        fixture: 'regression',
        expectedMessage: 'Profiling regression: missing required metric "warm.raw_text_embedding_cache_hit_rate".',
      },
      {
        fixture: 'regression-cache-hit',
        expectedMessage:
          'Profiling regression: warm raw_text_embedding_cache_hit_rate 0.5 was not higher than cold 0.5.',
      },
      {
        fixture: 'regression-slowdown',
        expectedMessage:
          'Profiling regression: warm total_rebuild_ms 3200 exceeded 5% slowdown threshold 3087 against cold 2940.',
      },
    ] as const

    for (const testCase of cases) {
      if (fs.existsSync(artifactPath)) {
        fs.unlinkSync(artifactPath)
      }

      const run = spawnSync(
        'node',
        ['scripts/profile-knowledge-rebuild.mjs', '--fixture', testCase.fixture, '--mode', 'compare'],
        {
          cwd: root,
          encoding: 'utf8',
        },
      )

      expect(run.status, testCase.fixture).toBe(1)
      expect(run.stderr.trim(), testCase.fixture).toBe(testCase.expectedMessage)
      expect(fs.existsSync(artifactPath), testCase.fixture).toBe(true)

      const parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
        fixture: string
        mode: string
      }

      expect(parsed.fixture).toBe(testCase.fixture)
      expect(parsed.mode).toBe('compare')
    }
  })
})
