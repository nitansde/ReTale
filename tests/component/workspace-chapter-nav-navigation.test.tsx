// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChapterNav } from '@/components/workspace/WorkspaceChapterNav'
import type { ChapterTimelineItem, StoryTimelineBranchNode, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'zh',
    t: (key: string) => key,
  }),
}))

function mainlineChapter(chapterNo: number): Chapter {
  return {
    id: `chapter-${chapterNo}`,
    novelId: 'novel-1',
    title: `第${chapterNo}章 标题`,
    order: chapterNo,
    content: `<p>第${chapterNo}章正文</p>`,
    status: 'draft',
    wordCount: chapterNo * 10,
    updatedAt: 'now',
  }
}

function timelineChapter(chapterNo: number): ChapterTimelineItem {
  const completeLongSummary = '主角在旧港口确认失踪者留下的暗号，并由此判断真正的接头地点不在仓库，而是在潮水退去后才会显露的礁洞。'
  return {
    type: 'chapter',
    chapterId: `chapter-${chapterNo}`,
    chapterNo,
    title: `第${chapterNo}章 标题`,
    wordCount: chapterNo * 10,
    summary: chapterNo === 5
      ? '早期线索在旧码头出现。'
      : chapterNo === 150
        ? completeLongSummary
        : `第${chapterNo}章的一句话情节。`,
  }
}

function rewriteNode(anchorChapterNo: number): StoryTimelineBranchNode {
  return {
    type: 'branch_node',
    id: `rewrite-${anchorChapterNo}`,
    nodeType: 'rewrite',
    anchorChapterNo,
    parentNodeId: null,
    title: '魔改节点',
    subtitle: '改变这一章的走向',
    laneIndex: 0,
    colorToken: null,
    sourceChapterNo: anchorChapterNo,
    targetChapterNo: null,
    continueBlockId: `continue-${anchorChapterNo}`,
    whatIfSessionId: null,
    futureJumpRunId: null,
    status: 'active',
  }
}

const animationFrames = new Map<number, FrameRequestCallback>()

function flushAnimationFrames() {
  act(() => {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    callbacks.forEach((callback) => callback(0))
  })
}

function mockNavigationGeometry() {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'chapter-navigation-scroll' ? 400 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'chapter-navigation-scroll') return { top: 100 } as DOMRect
    if (this.dataset.navigationTarget === 'true') {
      const scroll = this.closest<HTMLElement>('[data-testid="chapter-navigation-scroll"]')!
      const top = this.dataset.testid?.startsWith('timeline-node-') ? 740
        : this.textContent?.includes('魔改版') ? 620 : 500
      return { top: top - scroll.scrollTop, height: 80 } as DOMRect
    }
    return { top: 0, left: 0, width: 0, height: 0 } as DOMRect
  })
}

function navigationProps(): ComponentProps<typeof WorkspaceChapterNav> {
  const chapters = Array.from({ length: 20 }, (_, index) => mainlineChapter(index + 1))
  return {
    leftPanelOpen: true,
    onClose: vi.fn(),
    onCreateChapter: vi.fn(),
    sortedChapters: chapters,
    currentNovelId: 'novel-1',
    storyTimelineError: '',
    branchNodes: [],
    edges: [],
    timelineChapterById: new Map(chapters.map((chapter) => [chapter.id, timelineChapter(chapter.order)])),
    currentChapterId: 'chapter-20',
    activeSelection: { kind: 'chapter', chapterId: 'chapter-20', chapterNo: 20 },
    branchChaptersByParentId: new Map(),
    onSelectionChange: vi.fn(),
    onDeleteChapter: vi.fn(),
    deletingBranchNodeId: null,
    onDeleteBranchNode: vi.fn(),
  }
}

beforeEach(() => {
  animationFrames.clear()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    animationFrames.set(++frameId, callback)
    return frameId
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => animationFrames.delete(id)))
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('workspace chapter navigation', () => {
  it('centers a bounded chapter window, shows mainline summaries, and searches the whole novel', () => {
    const mainline = Array.from({ length: 200 }, (_, index) => mainlineChapter(index + 1))
    const branch: Chapter = {
      ...mainlineChapter(150),
      id: 'chapter-150-branch',
      parentChapterId: 'chapter-150',
      title: '魔改版本',
      content: '<p>魔改摘要不应显示</p>',
    }
    const onSelectionChange = vi.fn()

    render(
      <WorkspaceChapterNav
        leftPanelOpen={false}
        onClose={vi.fn()}
        onCreateChapter={vi.fn()}
        sortedChapters={[...mainline, branch]}
        currentNovelId="novel-1"
        storyTimelineError=""
        branchNodes={[]}
        edges={[]}
        timelineChapterById={new Map(mainline.map((chapter) => {
          const item = timelineChapter(chapter.order)
          return [chapter.id, item] as const
        }))}
        currentChapterId="chapter-150"
        activeSelection={{ kind: 'chapter', chapterId: 'chapter-150', chapterNo: 150 }}
        branchChaptersByParentId={new Map([['chapter-150', [branch]]])}
        onSelectionChange={onSelectionChange}
        onDeleteChapter={vi.fn()}
        deletingBranchNodeId={null}
        onDeleteBranchNode={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('timeline-chapter-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('timeline-chapter-150')).toHaveAttribute('data-navigation-current', 'true')
    const completeSummary = screen.getByText('主角在旧港口确认失踪者留下的暗号，并由此判断真正的接头地点不在仓库，而是在潮水退去后才会显露的礁洞。')
    expect(completeSummary).toBeInTheDocument()
    expect(completeSummary.className).not.toMatch(/line-clamp-/)
    expect(screen.getByText('魔改版本')).toBeInTheDocument()
    expect(screen.queryByText('魔改摘要不应显示')).not.toBeInTheDocument()
    const rangeControls = screen.getByTestId('chapter-navigation-range-controls')
    expect(rangeControls.nextElementSibling).toBe(screen.getByTestId('chapter-navigation-scroll'))

    const search = screen.getByLabelText('chapterNav.searchLabel')
    fireEvent.change(search, { target: { value: '早期线索' } })

    expect(screen.getByTestId('timeline-chapter-5')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-chapter-150')).not.toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: 'chapter', chapterId: 'chapter-5', chapterNo: 5 })
  })

  it('centers the exact selected mainline chapter, branch chapter, or rewrite node whenever the mobile directory opens', () => {
    mockNavigationGeometry()
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const mainline = Array.from({ length: 200 }, (_, index) => mainlineChapter(index + 1))
    const branch: Chapter = {
      ...mainlineChapter(150),
      id: 'chapter-150-branch',
      parentChapterId: 'chapter-150',
      title: '第150章魔改版',
    }
    const node = rewriteNode(150)
    let currentChapterId = 'chapter-150'
    let activeSelection: TimelineSelection = { kind: 'chapter', chapterId: currentChapterId, chapterNo: 150 }

    const nav = (open: boolean) => (
      <WorkspaceChapterNav
        leftPanelOpen={open}
        onClose={vi.fn()}
        onCreateChapter={vi.fn()}
        sortedChapters={[...mainline, branch]}
        currentNovelId="novel-1"
        storyTimelineError=""
        branchNodes={[node]}
        edges={[]}
        timelineChapterById={new Map(mainline.map((chapter) => [chapter.id, timelineChapter(chapter.order)]))}
        currentChapterId={currentChapterId}
        activeSelection={activeSelection}
        branchChaptersByParentId={new Map([['chapter-150', [branch]]])}
        onSelectionChange={vi.fn()}
        onDeleteChapter={vi.fn()}
        deletingBranchNodeId={null}
        onDeleteBranchNode={vi.fn()}
      />
    )

    const { rerender } = render(nav(false))
    rerender(nav(true))

    let scrollContainer = screen.getByTestId('chapter-navigation-scroll')
    let activeTarget = scrollContainer.querySelector<HTMLElement>('[data-navigation-target="true"]')
    expect(activeTarget).toHaveTextContent('第150章 标题')
    flushAnimationFrames()
    expect(scrollContainer.scrollTop).toBe(240)
    scrollContainer.scrollTop = 0

    rerender(nav(false))
    rerender(nav(true))
    scrollContainer = screen.getByTestId('chapter-navigation-scroll')
    flushAnimationFrames()
    expect(scrollContainer.scrollTop).toBe(240)

    currentChapterId = branch.id
    activeSelection = { kind: 'chapter', chapterId: branch.id, chapterNo: 150 }
    rerender(nav(false))
    rerender(nav(true))
    scrollContainer = screen.getByTestId('chapter-navigation-scroll')
    activeTarget = scrollContainer.querySelector<HTMLElement>('[data-navigation-target="true"]')
    expect(activeTarget).toHaveTextContent('第150章魔改版')
    flushAnimationFrames()
    expect(scrollContainer.scrollTop).toBe(360)

    currentChapterId = 'chapter-150'
    activeSelection = { kind: 'rewrite', nodeId: node.id, continueBlockId: node.continueBlockId!, anchorChapterNo: 150 }
    rerender(nav(false))
    rerender(nav(true))
    scrollContainer = screen.getByTestId('chapter-navigation-scroll')
    activeTarget = scrollContainer.querySelector<HTMLElement>('[data-navigation-target="true"]')
    expect(activeTarget).toBe(screen.getByTestId(`timeline-node-${node.id}`))
    expect(activeTarget).toHaveTextContent('魔改节点')
    flushAnimationFrames()
    expect(scrollContainer.scrollTop).toBe(480)
  })

  it.each([true, false])('preserves manual scrolling across background directory updates (desktop: %s)', (desktop) => {
    vi.mocked(window.matchMedia).mockReturnValue({ ...window.matchMedia(''), matches: desktop })
    mockNavigationGeometry()
    const props = navigationProps()
    const { rerender } = render(<WorkspaceChapterNav {...props} />)
    flushAnimationFrames()
    const scroll = screen.getByTestId('chapter-navigation-scroll')
    expect(scroll.scrollTop).toBe(240)
    scroll.scrollTop = 15
    fireEvent.scroll(scroll)

    for (const update of [
      { timelineChapterById: new Map([...props.timelineChapterById].map(([id, chapter]) => [id, { ...chapter, summary: '后台更新的章节摘要' }])) },
      { branchNodes: [rewriteNode(20)] },
      { branchChaptersByParentId: new Map() },
      { sortedChapters: props.sortedChapters.map((chapter) => ({ ...chapter })) },
    ]) {
      Object.assign(props, update)
      rerender(<WorkspaceChapterNav {...props} />)
      flushAnimationFrames()
      expect(scroll.scrollTop).toBe(15)
    }

    rerender(<WorkspaceChapterNav {...props} currentChapterId="chapter-19" activeSelection={{ kind: 'chapter', chapterId: 'chapter-19', chapterNo: 19 }} />)
    flushAnimationFrames()
    expect(scroll.scrollTop).toBe(240)
  })

  it.each(['wheel', 'touchStart', 'pointerDown', 'keyDown', 'scroll'] as const)('does not run a delayed centering after user %s', (event) => {
    mockNavigationGeometry()
    render(<WorkspaceChapterNav {...navigationProps()} />)
    const scroll = screen.getByTestId('chapter-navigation-scroll')
    fireEvent[event](scroll)
    scroll.scrollTop = 10
    flushAnimationFrames()
    expect(scroll.scrollTop).toBe(10)
  })

  it.each([true, false])('centers a late-loading selection only before manual interaction (interacted: %s)', (interacted) => {
    mockNavigationGeometry()
    const node = rewriteNode(20)
    const props = navigationProps()
    props.activeSelection = { kind: 'rewrite', nodeId: node.id, continueBlockId: node.continueBlockId!, anchorChapterNo: 20 }
    const { rerender } = render(<WorkspaceChapterNav {...props} />)
    flushAnimationFrames()
    const scroll = screen.getByTestId('chapter-navigation-scroll')
    if (interacted) fireEvent.touchStart(scroll)

    rerender(<WorkspaceChapterNav {...props} branchNodes={[node]} />)
    flushAnimationFrames()
    expect(scroll.scrollTop).toBe(interacted ? 0 : 480)
  })
})
