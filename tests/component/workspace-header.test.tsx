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
  it('provides the six prioritized mobile controls with 44px targets', () => {
    const actions = renderHeader()

    expect(screen.getByTestId('workspace-mobile-header')).toHaveClass('grid-cols-[44px_44px_minmax(0,1fr)_44px_44px_44px]')
    const chapterButton = screen.getByRole('button', { name: 'workspace.header.openChapters' })
    expect(chapterButton).toHaveClass('min-h-11', 'min-w-11')
    fireEvent.click(chapterButton)
    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.openContext' }))
    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.openKnowledge' }))
    expect(actions.onOpenChapters).toHaveBeenCalledTimes(1)
    expect(actions.onOpenContext).toHaveBeenCalledTimes(1)
    expect(actions.onOpenKnowledge).toHaveBeenCalledTimes(1)
  })

  it('moves metrics, settings, presets, and deletion into a labelled mobile overflow dialog', () => {
    const actions = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.moreOptions' }))

    expect(screen.getByRole('dialog', { name: 'workspace.header.overflowTitle' })).toBeInTheDocument()
    expect(screen.getByText('workspace.header.metrics')).toBeInTheDocument()
    expect(screen.getByText('workspace.header.destructiveActions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.modelSettings' }))
    expect(actions.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'workspace.header.overflowTitle' })).not.toBeInTheDocument()
  })
})
