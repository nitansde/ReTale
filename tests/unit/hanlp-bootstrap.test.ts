import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HANLP_BOOTSTRAP_OUTPUT_SCHEMA_VERSION,
  UNKNOWN_LOCAL_CONFIG_MARKER,
  buildHanlpBootstrapCacheKey,
  buildHanlpModelOrConfigHash,
  buildHanlpScriptVersionHash,
  resolveHanlpBootstrapTimeoutMs,
  validateHanlpBootstrapOutput,
} from '@/lib/server/hanlp-bootstrap'

const ORIGINAL_HANLP_BOOTSTRAP_TIMEOUT_MS = process.env.HANLP_BOOTSTRAP_TIMEOUT_MS

afterEach(() => {
  process.env.HANLP_BOOTSTRAP_TIMEOUT_MS = ORIGINAL_HANLP_BOOTSTRAP_TIMEOUT_MS
})

describe('hanlp bootstrap helpers', () => {
  it('builds cache keys from explicit invalidation dimensions', () => {
    const scriptPath = path.join(process.cwd(), 'missing-hanlp-bootstrap.py')
    const first = buildHanlpBootstrapCacheKey({
      chapterText: '阿离\r\n去了北京',
      scriptPath,
      modelOrConfigIdentity: null,
    })
    const second = buildHanlpBootstrapCacheKey({
      chapterText: '阿离\n去了北京',
      scriptPath,
      modelOrConfigIdentity: null,
    })
    const third = buildHanlpBootstrapCacheKey({
      chapterText: '阿离\n去了上海',
      scriptPath,
      modelOrConfigIdentity: 'local-model:v2',
    })

    expect(first.chapterTextHash).toBe(second.chapterTextHash)
    expect(first.hanlpModelOrConfigHash).toBe(UNKNOWN_LOCAL_CONFIG_MARKER)
    expect(third.chapterTextHash).not.toBe(first.chapterTextHash)
    expect(third.hanlpModelOrConfigHash).not.toBe(UNKNOWN_LOCAL_CONFIG_MARKER)
    expect(third.inputHash).not.toBe(first.inputHash)
  })

  it('uses a deterministic script hash fallback when the local script is absent', () => {
    const scriptPath = path.join(process.cwd(), 'missing-hanlp-bootstrap.py')
    const first = buildHanlpScriptVersionHash(scriptPath, HANLP_BOOTSTRAP_OUTPUT_SCHEMA_VERSION)
    const second = buildHanlpScriptVersionHash(scriptPath, HANLP_BOOTSTRAP_OUTPUT_SCHEMA_VERSION)
    const differentSchema = buildHanlpScriptVersionHash(scriptPath, 'v2')

    expect(first).toBe(second)
    expect(differentSchema).not.toBe(first)
  })

  it('normalizes mention text against the persisted newline convention', () => {
    const output = validateHanlpBootstrapOutput(
      {
        people: [
          {
            text: '阿离',
            totalCount: 1,
            chapterCount: 1,
            coverageRatio: 1,
            score: 0.91,
            chapters: [{ chapterNo: 3, mentions: [{ startOffset: 0, endOffset: 2, text: 'ignored' }] }],
          },
        ],
        locations: [
          {
            text: '北京',
            totalCount: 1,
            chapterCount: 1,
            coverageRatio: 1,
            score: 0.44,
            chapters: [{ chapterNo: 3, mentions: [{ startOffset: 4, endOffset: 6 }] }],
          },
        ],
        organizations: [],
        settings: [],
      },
      { chapterNo: 3, chapterText: '阿离\r\n去北京' },
    )

    expect(output.people[0].chapters[0].mentions[0]).toEqual({
      text: '阿离',
      startOffset: 0,
      endOffset: 2,
    })
    expect(output.locations[0].chapters[0].mentions[0]).toEqual({
      text: '北京',
      startOffset: 4,
      endOffset: 6,
    })
    expect(output.entities).toHaveLength(2)
  })

  it('rejects malformed output that omits required groups or per-chapter mentions', () => {
    expect(() => validateHanlpBootstrapOutput(
      {
        people: [],
        locations: [],
        organizations: [],
      },
      { chapterNo: 1, chapterText: '正文' },
    )).toThrow(/settings array/)

    expect(() => validateHanlpBootstrapOutput(
      {
        people: [{ text: '阿离', totalCount: 1, chapterCount: 1, coverageRatio: 1, score: 0.5, chapters: [] }],
        locations: [],
        organizations: [],
        settings: [],
      },
      { chapterNo: 1, chapterText: '阿离' },
    )).toThrow(/non-empty array|mentions/)
  })

  it('keeps the unknown config marker explicit instead of null hashing', () => {
    expect(buildHanlpModelOrConfigHash(null)).toBe(UNKNOWN_LOCAL_CONFIG_MARKER)
    expect(buildHanlpModelOrConfigHash('  ')).toBe(UNKNOWN_LOCAL_CONFIG_MARKER)
    expect(buildHanlpModelOrConfigHash('hanlp-local-model')).not.toBe(UNKNOWN_LOCAL_CONFIG_MARKER)
  })

  it('resolves HanLP timeout from explicit options, env, or the long-running default', () => {
    process.env.HANLP_BOOTSTRAP_TIMEOUT_MS = '900000'
    expect(resolveHanlpBootstrapTimeoutMs(1234)).toBe(1234)
    expect(resolveHanlpBootstrapTimeoutMs()).toBe(900000)

    process.env.HANLP_BOOTSTRAP_TIMEOUT_MS = 'invalid'
    expect(resolveHanlpBootstrapTimeoutMs()).toBe(600000)
  })
})
