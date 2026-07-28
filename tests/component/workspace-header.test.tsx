// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader'

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}))

function renderHeader() {
  const actions = {
    onOpenChapters: vi.fn(),
    onOpenContext: vi.fn(),
    onOpenKnowledge: vi.fn(),
    onOpenPresets: vi.fn(),
    onOpenSettings: vi.fn(),
    onDeleteNovel: vi.fn(),
  }
  render(
    <WorkspaceHeader
      title="A very long current chapter title that must truncate"
      metrics={{ wordCount: '1,200 words', inputTokens: '100 input', outputTokens: '200 output' }}
      providerLabel="Local model"
      deletionPending={false}
      {...actions}
    />
  )
  return actions
}

describe('WorkspaceHeader', () => {
  it('provides five mobile slots with four 44px controls and the requested icons', () => {
    const actions = renderHeader()
    const header = screen.getByTestId('workspace-mobile-header')

    expect(header).toHaveClass('grid-cols-[44px_44px_minmax(0,1fr)_44px_44px]')
    expect(header.children).toHaveLength(5)
    const chapterButton = screen.getByRole('button', { name: 'workspace.header.openChapters' })
    const contextButton = screen.getByRole('button', { name: 'workspace.header.openContext' })
    const optionsButton = screen.getByRole('button', { name: 'workspace.header.moreOptions' })
    expect(chapterButton).toHaveClass('min-h-11', 'min-w-11')
    expect(contextButton.querySelector('.lucide-brain')).toBeInTheDocument()
    expect(optionsButton.querySelector('.lucide-ellipsis')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workspace.header.openKnowledge' })).not.toBeInTheDocument()

    fireEvent.click(chapterButton)
    fireEvent.click(contextButton)
    expect(actions.onOpenChapters).toHaveBeenCalledTimes(1)
    expect(actions.onOpenContext).toHaveBeenCalledTimes(1)
    expect(actions.onOpenKnowledge).not.toHaveBeenCalled()
  })

  it('opens knowledge status through overflow after closing the options dialog', () => {
    const actions = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.moreOptions' }))

    expect(screen.getByRole('dialog', { name: 'workspace.header.overflowTitle' })).toBeInTheDocument()
    expect(screen.getByText('workspace.header.metrics')).toBeInTheDocument()
    expect(screen.getByText('workspace.header.destructiveActions')).toBeInTheDocument()
    const knowledgeButton = screen.getByRole('button', { name: 'workspace.header.openKnowledge' })
    expect(knowledgeButton.querySelector('.lucide-brain')).toBeInTheDocument()
    fireEvent.click(knowledgeButton)
    expect(actions.onOpenKnowledge).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'workspace.header.overflowTitle' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.moreOptions' }))
    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.modelSettings' }))
    expect(actions.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'workspace.header.overflowTitle' })).not.toBeInTheDocument()
  })
})
