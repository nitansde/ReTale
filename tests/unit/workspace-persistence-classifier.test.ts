import { describe, expect, it } from 'vitest'
import { createEmptyWorkspaceState } from '@/lib/workspace-state'
import type { PersistedNovelState } from '@/lib/types'
import { classifyWorkspacePersistence } from '@/store/workspace-persistence-classifier'

function createWorkspace(): PersistedNovelState {
  return {
    ...createEmptyWorkspaceState(),
    currentNovelId: 'novel-1',
    currentChapterId: 'chapter-1',
    localNovels: [{ id: 'novel-1', title: 'Novel', summary: '', tags: [] }],
    localChapters: [
      { id: 'chapter-1', novelId: 'novel-1', title: 'One', order: 1, content: '<p>One</p>', originalContent: '<p>Original</p>', status: 'draft', wordCount: 1, updatedAt: 'one' },
      { id: 'chapter-2', novelId: 'novel-1', title: 'Two', order: 2, content: '<p>Two</p>', status: 'draft', wordCount: 1, updatedAt: 'two' },
    ],
  }
}

describe('workspace persistence classifier', () => {
  const postCases: Array<[string, (workspace: PersistedNovelState) => void]> = [
    ['novel metadata change', (workspace) => { workspace.localNovels[0]!.title = 'Renamed' }],
    ['chapter creation', (workspace) => { workspace.localChapters.push({ ...workspace.localChapters[1]!, id: 'chapter-3' }) }],
    ['chapter deletion', (workspace) => { workspace.localChapters.pop() }],
    ['chapter reorder', (workspace) => { workspace.localChapters.reverse() }],
    ['chapter title change', (workspace) => { workspace.localChapters[0]!.title = 'Renamed' }],
    ['chapter status change', (workspace) => { workspace.localChapters[0]!.status = 'review' }],
    ['chapter original content change', (workspace) => { workspace.localChapters[0]!.originalContent = '<p>Changed</p>' }],
    ['chapter branch change', (workspace) => { workspace.localChapters[0]!.parentChapterId = 'chapter-2' }],
    ['two chapter changes', (workspace) => {
      workspace.localChapters[0]!.content = '<p>Edited one</p>'
      workspace.localChapters[1]!.content = '<p>Edited two</p>'
    }],
  ]

  it.each(postCases)('classifies %s as POST', (_name, mutate) => {
    const baseline = createWorkspace()
    const current = structuredClone(baseline)
    mutate(current)
    expect(classifyWorkspacePersistence(baseline, current)).toEqual({ kind: 'post' })
  })

  it('skips persistence when only browser-local workspace session fields change', () => {
    const baseline = createWorkspace()
    const current = structuredClone(baseline)
    current.currentChapterId = 'chapter-2'
    current.presetCompatSessionState = {
      'chapter:chapter-2::rewrite': {
        surfaceId: 'rewrite',
        phase: 'new_chat',
        resetPending: true,
      },
    }

    expect(classifyWorkspacePersistence(baseline, current)).toEqual({ kind: 'none' })
  })

  it('classifies coalesced edits to one existing chapter as PATCH', () => {
    const baseline = createWorkspace()
    const current = structuredClone(baseline)
    Object.assign(current.localChapters[0]!, {
      content: '<p>Edited twice</p>',
      wordCount: 2,
      updatedAt: 'later',
    })

    expect(classifyWorkspacePersistence(baseline, current)).toEqual({
      kind: 'patch',
      chapter: current.localChapters[0],
    })
  })

  it('ignores AI settings persisted through the separate settings endpoint', () => {
    const baseline = createWorkspace()
    const current = structuredClone(baseline)
    current.aiSettings = { ...current.aiSettings!, rewrite: { ...current.aiSettings!.rewrite, provider: 'ollama' } }
    current.localChapters[0]!.content = '<p>Edited</p>'

    expect(classifyWorkspacePersistence(baseline, current).kind).toBe('patch')
  })
})
