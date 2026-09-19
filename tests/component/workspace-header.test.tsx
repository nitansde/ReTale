// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader'

vi.mock('next/link', () => ({
  default: ({ onNavigate, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    onNavigate?: (event: { preventDefault: () => void }) => void
  }) => (
    <a
      {...props}
      onClick={(event) => {
        onNavigate?.({ preventDefault: () => event.preventDefault() })
      }}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}))

function renderHeader() {
  const actions = {
    onSearch: vi.fn(),
    onOpenChapters: vi.fn(),
    onOpenContext: vi.fn(),
    onOpenKnowledge: vi.fn(),
    onOpenPresets: vi.fn(),
    onOpenSettings: vi.fn(),
    onDeleteNovel: vi.fn(),
    onBackToLibrary: vi.fn().mockResolvedValue(undefined),
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
  it('keeps the title in the header and reading actions in the mobile toolbar', () => {
    const actions = renderHeader()
    const header = screen.getByTestId('workspace-mobile-header')

    expect(within(header).getByRole('heading')).toHaveTextContent('A very long current chapter title')
    expect(within(header).queryByRole('button', { name: 'bookSearch.open' })).not.toBeInTheDocument()
    const toolbar = screen.getByTestId('workspace-mobile-toolbar')
    const chapterButton = within(header).getByRole('button', { name: 'workspace.header.openChapters' })
    expect(within(toolbar).getByRole('link', { name: 'workspace.header.backToLibrary' })).toHaveTextContent('workspace.header.home')
    const searchButton = within(toolbar).getByRole('button', { name: 'bookSearch.open' })
    fireEvent.click(searchButton)
    expect(actions.onSearch).toHaveBeenCalledTimes(1)
    const contextButton = screen.getByRole('button', { name: 'workspace.header.openContext' })
    const optionsButton = screen.getByRole('button', { name: 'workspace.header.moreOptions' })
    expect(chapterButton).toBeEnabled()
    expect(contextButton.querySelector('.lucide-book-marked')).toBeInTheDocument()
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

    const dialog = screen.getByRole('dialog', { name: 'workspace.header.overflowTitle' })
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    const knowledgeButton = screen.getByRole('button', { name: 'workspace.header.openKnowledge' })
    expect(knowledgeButton.querySelector('.lucide-book-marked')).toBeInTheDocument()
    fireEvent.click(knowledgeButton)
    expect(actions.onOpenKnowledge).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'workspace.header.overflowTitle' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'workspace.header.moreOptions' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'settings.title' }))
    expect(actions.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'workspace.header.overflowTitle' })).not.toBeInTheDocument()
  })

  it('guards client navigation until the async back callback settles', async () => {
    let resolveBack: () => void = () => undefined
    const pendingBack = new Promise<void>((resolve) => { resolveBack = resolve })
    const actions = renderHeader()
    actions.onBackToLibrary.mockReturnValueOnce(pendingBack)
    const backLink = within(screen.getByTestId('workspace-mobile-toolbar')).getByRole('link', { name: 'workspace.header.backToLibrary' })

    fireEvent.click(backLink)
    fireEvent.click(backLink)

    expect(actions.onBackToLibrary).toHaveBeenCalledTimes(1)
    expect(backLink).toHaveAttribute('aria-busy', 'true')

    resolveBack()
    await waitFor(() => expect(backLink).toHaveAttribute('aria-busy', 'false'))
  })
})
