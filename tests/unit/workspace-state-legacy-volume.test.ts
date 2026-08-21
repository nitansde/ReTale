import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

function createLegacyChapter(id: string, volumeId: string, order: number) {
  return {
    id,
    novelId: 'novel-1',
    volumeId,
    title: id,
    order,
    content: `<p>${id}</p>`,
    status: 'draft' as const,
    wordCount: 1,
    updatedAt: 'now',
  }
}

describe('legacy volume workspace normalization', () => {
  it('flattens per-volume chapter order into one novel-wide sequence and removes volume fields', () => {
    const normalized = normalizeWorkspaceState({
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localNovels: [{ id: 'novel-1', title: 'Novel', summary: '', tags: [] }],
      localVolumes: [
        { id: 'volume-2', novelId: 'novel-1', order: 2 },
        { id: 'volume-1', novelId: 'novel-1', order: 1 },
      ],
      localChapters: [
        createLegacyChapter('chapter-3', 'volume-2', 1),
        createLegacyChapter('chapter-1', 'volume-1', 1),
        createLegacyChapter('chapter-4', 'volume-2', 2),
        createLegacyChapter('chapter-2', 'volume-1', 2),
      ],
      expandedVolumeIds: ['volume-1'],
    })

    expect(normalized.localChapters.map((chapter) => [chapter.id, chapter.order])).toEqual([
      ['chapter-3', 3],
      ['chapter-1', 1],
      ['chapter-4', 4],
      ['chapter-2', 2],
    ])
    expect(normalized).not.toHaveProperty('localVolumes')
    expect(normalized).not.toHaveProperty('expandedVolumeIds')
    expect(normalized.localChapters.every((chapter) => !('volumeId' in chapter))).toBe(true)
    expect(JSON.stringify(normalized)).not.toMatch(/volume(Id|s)/i)
  })
})
