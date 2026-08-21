import fs from 'node:fs'
import path from 'node:path'
import { createEmptyWorkspaceState } from '@/lib/workspace-state'
import type { PersistedNovelState } from '@/lib/types'
import { assertOwnedTestPath, markOwnedTestRoot } from '../../scripts/test-path-safety.mjs'

export const AUTOSAVE_PERFORMANCE_CHAPTER_COUNT = 1_000
export const AUTOSAVE_EDIT_BURST_LENGTH = 10_000
export const AUTOSAVE_PERFORMANCE_NOVEL_ID = 'phase-0-autosave-novel'
export const AUTOSAVE_PERFORMANCE_VOLUME_ID = 'phase-0-autosave-volume'
export const AUTOSAVE_PERFORMANCE_CHAPTER_ID = 'phase-0-autosave-chapter-0001'

const PERFORMANCE_FIXTURE_ROOT = path.join(process.cwd(), '.sisyphus/evidence/performance-characterization')

export function buildTenThousandCharacterEditBurst() {
  const prefix = 'phase-0-autosave-edit:'
  return `${prefix}${'x'.repeat(AUTOSAVE_EDIT_BURST_LENGTH - prefix.length)}`
}

export function buildThousandChapterWorkspace(): PersistedNovelState {
  const base = createEmptyWorkspaceState()
  const localChapters = Array.from({ length: AUTOSAVE_PERFORMANCE_CHAPTER_COUNT }, (_, index) => {
    const chapterNumber = index + 1
    const chapterId = `phase-0-autosave-chapter-${String(chapterNumber).padStart(4, '0')}`
    const text = `Phase 0 chapter ${chapterNumber} baseline content.`

    return {
      id: chapterId,
      novelId: AUTOSAVE_PERFORMANCE_NOVEL_ID,
      title: `Chapter ${chapterNumber}`,
      order: chapterNumber,
      content: `<p>${text}</p>`,
      originalContent: `<p>${text}</p>`,
      status: 'draft' as const,
      wordCount: 6,
      updatedAt: '2026-08-12T00:00:00.000Z',
    }
  })

  return {
    ...base,
    currentNovelId: AUTOSAVE_PERFORMANCE_NOVEL_ID,
    currentChapterId: AUTOSAVE_PERFORMANCE_CHAPTER_ID,
    localNovels: [{
      id: AUTOSAVE_PERFORMANCE_NOVEL_ID,
      title: 'Phase 0 Autosave Performance Fixture',
      summary: 'Deterministic 1,000-chapter autosave characterization workspace.',
      tags: ['phase-0', 'performance'],
    }],
    localChapters,
  }
}

export function applyEditBurstToWorkspace(
  workspace: PersistedNovelState,
  editBurst = buildTenThousandCharacterEditBurst(),
): PersistedNovelState {
  return {
    ...workspace,
    localChapters: workspace.localChapters.map((chapter) => chapter.id === workspace.currentChapterId
      ? {
          ...chapter,
          content: `<p>${editBurst}</p>`,
          wordCount: editBurst.length,
          updatedAt: '2026-08-12T00:00:01.000Z',
        }
      : chapter),
  }
}

export function materializeAutosavePerformanceFixtures() {
  const ownedRoot = markOwnedTestRoot(PERFORMANCE_FIXTURE_ROOT, { repoRoot: process.cwd() })
  const fixtureDirectory = assertOwnedTestPath(ownedRoot, path.join(ownedRoot, 'fixtures'), {
    repoRoot: process.cwd(),
    label: 'autosave performance fixture directory',
  })
  const workspacePath = assertOwnedTestPath(ownedRoot, path.join(fixtureDirectory, 'workspace-1000-chapters.json'), {
    repoRoot: process.cwd(),
    label: 'autosave workspace fixture',
  })
  const editBurstPath = assertOwnedTestPath(ownedRoot, path.join(fixtureDirectory, 'edit-burst-10000.txt'), {
    repoRoot: process.cwd(),
    label: 'autosave edit burst fixture',
  })
  const evidencePath = assertOwnedTestPath(ownedRoot, path.join(ownedRoot, 'payload-construction.json'), {
    repoRoot: process.cwd(),
    label: 'autosave performance evidence',
  })
  const workspace = buildThousandChapterWorkspace()
  const editBurst = buildTenThousandCharacterEditBurst()

  fs.mkdirSync(fixtureDirectory, { recursive: true })
  fs.writeFileSync(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`)
  fs.writeFileSync(editBurstPath, editBurst)

  return { ownedRoot, fixtureDirectory, workspacePath, editBurstPath, evidencePath, workspace, editBurst }
}

export function writeAutosavePerformanceEvidence(evidencePath: string, evidence: unknown) {
  const ownedRoot = markOwnedTestRoot(PERFORMANCE_FIXTURE_ROOT, { repoRoot: process.cwd() })
  const safeEvidencePath = assertOwnedTestPath(ownedRoot, evidencePath, {
    repoRoot: process.cwd(),
    label: 'autosave performance evidence',
  })
  fs.writeFileSync(safeEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
}
