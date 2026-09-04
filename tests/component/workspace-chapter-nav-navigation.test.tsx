// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

beforeEach(() => {
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
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

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
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 })
    scrollContainer.getBoundingClientRect = vi.fn(() => ({ top: 100 } as DOMRect))
    let activeTarget = scrollContainer.querySelector<HTMLElement>('[data-navigation-target="true"]')
    expect(activeTarget).toHaveTextContent('第150章 标题')
    activeTarget!.getBoundingClientRect = vi.fn(() => ({ top: 500, height: 80 } as DOMRect))

    rerender(nav(false))
    rerender(nav(true))
    scrollContainer = screen.getByTestId('chapter-navigation-scroll')
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 })
    scrollContainer.getBoundingClientRect = vi.fn(() => ({ top: 100 } as DOMRect))
    activeTarget = scrollContainer.querySelector<HTMLElement>('[data-navigation-target="true"]')
    activeTarget!.getBoundingClientRect = vi.fn(() => ({ top: 500, height: 80 } as DOMRect))
    rerender(nav(true))
    expect(scrollContainer.scrollTop).toBe(240)

    currentChapterId = branch.id
    activeSelection = { kind: 'chapter', chapterId: branch.id, chapterNo: 150 }
    rerender(nav(false))
    rerender(nav(true))
    scrollContainer = screen.getByTestId('chapter-navigation-scroll')
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 })
    scrollContainer.getBoundingClientRect = vi.fn(() => ({ top: 100 } as DOMRect))
    activeTarget = scrollContainer.querySelector<HTMLElement>('[data-navigation-target="true"]')
    expect(activeTarget).toHaveTextContent('第150章魔改版')
    activeTarget!.getBoundingClientRect = vi.fn(() => ({ top: 620, height: 80 } as DOMRect))
    rerender(nav(true))
    expect(scrollContainer.scrollTop).toBe(360)

    currentChapterId = 'chapter-150'
    activeSelection = { kind: 'rewrite', nodeId: node.id, continueBlockId: node.continueBlockId!, anchorChapterNo: 150 }
    rerender(nav(false))
    rerender(nav(true))
    scrollContainer = screen.getByTestId('chapter-navigation-scroll')
    activeTarget = scrollContainer.querySelector<HTMLElement>('[data-navigation-target="true"]')
    expect(activeTarget).toBe(screen.getByTestId(`timeline-node-${node.id}`))
    expect(activeTarget).toHaveTextContent('魔改节点')
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 })
    scrollContainer.getBoundingClientRect = vi.fn(() => ({ top: 100 } as DOMRect))
    activeTarget!.getBoundingClientRect = vi.fn(() => ({ top: 740, height: 80 } as DOMRect))
    rerender(nav(true))
    expect(scrollContainer.scrollTop).toBe(480)
  })
})
