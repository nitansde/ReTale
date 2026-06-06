// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhatIfSessionView } from '@/components/what-if/WhatIfSessionView'
import type { WhatIfSessionDetail } from '@/lib/story-branch-types'

const sessionDetail: WhatIfSessionDetail = {
  id: 'what-if-session-001',
  novelId: 'novel-001',
  baseBranchId: 'novel-001:main',
  sourceChapterNo: 10,
  title: 'IF-01 决裂线',
  premise: '如果他们在这里彻底闹翻。',
  selectedText: '“你根本没信过我。”',
  originalText: '原始章节正文',
  generatedText: '魔改后的 What-if 正文',
  status: 'active',
  createdAt: '2026-05-15T01:23:45.000Z',
  updatedAt: '2026-05-15T01:23:45.000Z',
  deltas: [
    {
      id: 'what-if-delta-001',
      sessionId: 'what-if-session-001',
      deltaType: 'relationship_change',
      subjectName: '男主',
      targetName: '女主',
      subjectEntityId: null,
      targetEntityId: null,
      key: 'relationship',
      oldValue: '信任',
      newValue: '决裂',
      validFromChapter: 10,
      description: '两人关系在这里彻底破裂。',
      confidence: 0.92,
      createdAt: '2026-05-15T01:23:45.000Z',
    },
  ],
  latestRevision: {
    revisionNo: 2,
    revisionKind: 'regenerate',
    userInstruction: '让冲突再锋利一些。',
    selectedText: '“你根本没信过我。”',
    originalText: '原始章节正文',
    generatedText: '魔改后的 What-if 正文',
    inputTokens: 120,
    outputTokens: 240,
    title: 'IF-01 决裂线',
    subtitle: null,
    createdAt: '2026-05-15T01:24:45.000Z',
  },
  revisionHistory: [
    { revisionNo: 1, revisionKind: 'initial', createdAt: '2026-05-15T01:23:45.000Z' },
    { revisionNo: 2, revisionKind: 'regenerate', createdAt: '2026-05-15T01:24:45.000Z' },
  ],
  revisions: [
    {
      revisionNo: 1,
      revisionKind: 'initial',
      userInstruction: '如果他们在这里彻底闹翻。',
      selectedText: '“你根本没信过我。”',
      originalText: '原始章节正文',
      generatedText: '第一版 What-if 正文',
      inputTokens: 100,
      outputTokens: 200,
      title: 'IF-01 决裂线',
      subtitle: null,
      createdAt: '2026-05-15T01:23:45.000Z',
    },
    {
      revisionNo: 2,
      revisionKind: 'regenerate',
      userInstruction: '让冲突再锋利一些。',
      selectedText: '“你根本没信过我。”',
      originalText: '原始章节正文',
      generatedText: '魔改后的 What-if 正文',
      inputTokens: 120,
      outputTokens: 240,
      title: 'IF-01 决裂线',
      subtitle: null,
      createdAt: '2026-05-15T01:24:45.000Z',
    },
  ],
}

describe('WhatIfSessionView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads persisted detail content and forwards session-scoped actions', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => sessionDetail,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const onJumpToFuture = vi.fn()
    const onRegenerateWhatIf = vi.fn()
    const onContinueInBranch = vi.fn()

    render(
      <WhatIfSessionView
        novelId="novel-001"
        branchId="novel-001:main"
        sessionId="what-if-session-001"
        anchorChapterNo={10}
        nodeTitle="IF-01 决裂线"
        nodeSubtitle="如果他们在这里闹翻"
        onJumpToFuture={onJumpToFuture}
        onRegenerateWhatIf={onRegenerateWhatIf}
        onContinueInBranch={onContinueInBranch}
      />
    )

    expect(await screen.findByTestId('what-if-view')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/what-if/sessions/what-if-session-001?novelId=novel-001&branchId=novel-001%3Amain',
        { cache: 'no-store' }
      )
    })

    expect(screen.getByText('IF-01 决裂线')).toBeInTheDocument()
    expect(screen.getByText('“你根本没信过我。”')).toBeInTheDocument()
    expect(screen.getByText('魔改后的 What-if 正文')).toBeInTheDocument()
    expect(screen.getByTestId('what-if-delta-list')).toBeInTheDocument()
    expect(screen.getByText('两人关系在这里彻底破裂。')).toBeInTheDocument()
    expect(screen.getByTestId('what-if-revision-history')).toHaveTextContent('第一版 What-if 正文')
    expect(screen.queryByText('当前版本')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('what-if-jump-button'))
    fireEvent.click(screen.getByRole('button', { name: '重新生成 What-if' }))
    fireEvent.click(screen.getByRole('button', { name: '在分支中继续' }))

    expect(onJumpToFuture).toHaveBeenCalledWith(sessionDetail)
    expect(onRegenerateWhatIf).toHaveBeenCalledWith(sessionDetail)
    expect(onContinueInBranch).toHaveBeenCalledWith(sessionDetail)
  })
})
