// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChapterNav } from '@/components/workspace/WorkspaceChapterNav'
import { WorkspaceReferencePanel } from '@/components/workspace/WorkspaceReferencePanel'

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}))

function setDesktopLayout(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

function renderChapterNav(options: { open: boolean; onClose?: () => void; onCreateChapter?: () => void }) {
  const onClose = options.onClose ?? vi.fn()
  const onCreateChapter = options.onCreateChapter ?? vi.fn()
  render(
    <WorkspaceChapterNav
      leftPanelOpen={options.open}
      onClose={onClose}
      onCreateChapter={onCreateChapter}
      sortedChapters={[]}
      chapterListTarget={80}
      currentNovelId="novel-1"
      setChapterListState={vi.fn()}
      storyTimelineError=""
      branchNodes={[]}
      edges={[]}
      timelineChapterById={new Map()}
      currentChapterId="chapter-1"
      activeSelection={null}
      branchChaptersByParentId={new Map()}
      onSelectionChange={vi.fn()}
      onDeleteChapter={vi.fn()}
      deletingBranchNodeId={null}
      onDeleteBranchNode={vi.fn()}
    />
  )
  return { onClose, onCreateChapter }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('responsive workspace panels', () => {
  it('renders the chapter navigator as a desktop aside regardless of mobile sheet state', () => {
    setDesktopLayout(true)
    renderChapterNav({ open: false })

    expect(screen.getByTestId('workspace-chapter-nav').tagName).toBe('ASIDE')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the mobile chapter sheet only while open and closes after creating a chapter', () => {
    setDesktopLayout(false)
    const onClose = vi.fn()
    const onCreateChapter = vi.fn()
    const { rerender } = render(
      <WorkspaceChapterNav
        leftPanelOpen={false}
        onClose={onClose}
        onCreateChapter={onCreateChapter}
        sortedChapters={[]}
        chapterListTarget={80}
        currentNovelId="novel-1"
        setChapterListState={vi.fn()}
        storyTimelineError=""
        branchNodes={[]}
        edges={[]}
        timelineChapterById={new Map()}
        currentChapterId="chapter-1"
        activeSelection={null}
        branchChaptersByParentId={new Map()}
        onSelectionChange={vi.fn()}
        onDeleteChapter={vi.fn()}
        deletingBranchNodeId={null}
        onDeleteBranchNode={vi.fn()}
      />
    )

    expect(screen.queryByTestId('workspace-chapter-nav')).not.toBeInTheDocument()
    rerender(
      <WorkspaceChapterNav
        leftPanelOpen
        onClose={onClose}
        onCreateChapter={onCreateChapter}
        sortedChapters={[]}
        chapterListTarget={80}
        currentNovelId="novel-1"
        setChapterListState={vi.fn()}
        storyTimelineError=""
        branchNodes={[]}
        edges={[]}
        timelineChapterById={new Map()}
        currentChapterId="chapter-1"
        activeSelection={null}
        branchChaptersByParentId={new Map()}
        onSelectionChange={vi.fn()}
        onDeleteChapter={vi.fn()}
        deletingBranchNodeId={null}
        onDeleteBranchNode={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog', { name: 'chapterNav.title' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'chapterNav.newChapter' }))
    expect(onCreateChapter).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps one desktop owner for context, knowledge, and references', () => {
    setDesktopLayout(true)
    render(
      <WorkspaceReferencePanel
        open={false}
        onClose={vi.fn()}
        knowledgeOpen={false}
        onKnowledgeClose={vi.fn()}
        contextLabel="Chapter"
        selectionActions={<div>selection actions</div>}
        knowledgeControls={<div>knowledge controls</div>}
        references={<div>reference content</div>}
      />
    )

    expect(screen.getByTestId('workspace-reference-panel').tagName).toBe('ASIDE')
    expect(screen.getAllByText('selection actions')).toHaveLength(1)
    expect(screen.getAllByText('knowledge controls')).toHaveLength(1)
    expect(screen.getAllByText('reference content')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps context and knowledge in separate mobile sheets without duplicate controls', () => {
    setDesktopLayout(false)
    const props = {
      onClose: vi.fn(),
      onKnowledgeClose: vi.fn(),
      contextLabel: 'Chapter',
      selectionActions: <div>selection actions</div>,
      knowledgeControls: <div>knowledge controls</div>,
      references: <div>reference content</div>,
    }
    const { rerender } = render(
      <WorkspaceReferencePanel {...props} open knowledgeOpen={false} />
    )

    expect(screen.getByRole('dialog', { name: 'workspace.context.title' })).toBeInTheDocument()
    expect(screen.getAllByText('selection actions')).toHaveLength(1)
    expect(screen.getAllByText('reference content')).toHaveLength(1)
    expect(screen.queryByText('knowledge controls')).not.toBeInTheDocument()

    rerender(<WorkspaceReferencePanel {...props} open={false} knowledgeOpen />)
    expect(screen.getByRole('dialog', { name: 'workspace.knowledge.sheetTitle' })).toBeInTheDocument()
    expect(screen.getAllByText('knowledge controls')).toHaveLength(1)
    expect(screen.queryByText('selection actions')).not.toBeInTheDocument()
    expect(screen.queryByText('reference content')).not.toBeInTheDocument()
  })
})
