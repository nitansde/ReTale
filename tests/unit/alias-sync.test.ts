import { describe, expect, it } from 'vitest'
import { buildOrderedBatchAliasDiscoveriesForTesting } from '@/lib/server/knowledge-rebuild'

describe('alias sync ordering', () => {
  it('sorts discoveries deterministically by chapter, output order, alias, and target', () => {
    const ordered = buildOrderedBatchAliasDiscoveriesForTesting([
      {
        chapterId: 'chapter-2',
        chapterNo: 2,
        extraction: {
          aliasDiscoveries: [
            { alias: '小李', target: '李青' },
            { alias: '阿离', target: '李青' },
          ],
        },
      },
      {
        chapterId: 'chapter-1',
        chapterNo: 1,
        extraction: {
          aliasDiscoveries: [
            { alias: '阿离', target: '李青' },
            { alias: '阿离', target: '赵七' },
          ],
        },
      },
    ])

    expect(ordered.map((item) => `${item.chapterNo}:${item.outputOrder}:${item.alias}->${item.target}`)).toEqual([
      '1:0:阿离->李青',
      '1:1:阿离->赵七',
      '2:0:小李->李青',
      '2:1:阿离->李青',
    ])
  })

  it('rejects generic and self-referential alias discoveries', () => {
    const ordered = buildOrderedBatchAliasDiscoveriesForTesting([
      {
        chapterId: 'chapter-1',
        chapterNo: 1,
        extraction: {
          aliasDiscoveries: [
            { alias: '他', target: '李青' },
            { alias: '阿离', target: '阿离' },
            { alias: '阿离', target: '李青' },
            { alias: '女人', target: '赵七' },
          ],
        },
      },
    ])

    expect(ordered).toEqual([
      {
        chapterId: 'chapter-1',
        chapterNo: 1,
        outputOrder: 2,
        alias: '阿离',
        target: '李青',
      },
    ])
  })

  it('keeps conflicting 小白 aliases in deterministic first-wins order', () => {
    const ordered = buildOrderedBatchAliasDiscoveriesForTesting([
      {
        chapterId: 'chapter-2',
        chapterNo: 2,
        extraction: {
          aliasDiscoveries: [
            { alias: '小白', target: '白狼' },
          ],
        },
      },
      {
        chapterId: 'chapter-1',
        chapterNo: 1,
        extraction: {
          aliasDiscoveries: [
            { alias: '小白', target: '白泽' },
            { alias: '小白', target: '白灵' },
          ],
        },
      },
    ])

    expect(ordered.map((item) => `${item.chapterNo}:${item.outputOrder}:${item.alias}->${item.target}`)).toEqual([
      '1:0:小白->白泽',
      '1:1:小白->白灵',
      '2:0:小白->白狼',
    ])
  })
})
