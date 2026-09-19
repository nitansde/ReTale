// @vitest-environment jsdom

import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DialogSurface } from '@/components/ui/DialogSurface'

describe('DialogSurface', () => {
  it('escapes filtered ancestors and keeps footer actions outside the scrolling content', () => {
    const { container } = render(
      <header style={{ backdropFilter: 'blur(20px)' }}>
        <DialogSurface open onClose={vi.fn()} title="Rewrite" closeLabel="Close" footer={<button>Generate</button>}>
          <label>Instructions<textarea /></label>
        </DialogSurface>
      </header>
    )
    const dialog = screen.getByRole('dialog')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(screen.getByRole('button', { name: 'Generate' }).closest('[data-testid="dialog-footer"]')?.parentElement).toBe(dialog)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('traps focus and Escape in only the top dialog and returns to its trigger', () => {
    const closeParent = vi.fn()
    function Harness() {
      const [childOpen, setChildOpen] = useState(false)
      return <DialogSurface open onClose={closeParent} title="Chapters" closeLabel="Close chapters">
        <button onClick={() => setChildOpen(true)}>Chapter options</button>
        <DialogSurface open={childOpen} onClose={() => setChildOpen(false)} title="Options" closeLabel="Close options">
          <button>Delete chapter</button>
        </DialogSurface>
      </DialogSurface>
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Chapter options' })
    trigger.focus()
    fireEvent.click(trigger)
    const child = screen.getByRole('dialog', { name: 'Options' })
    expect(within(child).getByRole('button', { name: 'Close options' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(within(child).getByRole('button', { name: 'Delete chapter' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Options' })).not.toBeInTheDocument()
    expect(closeParent).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body scrolling even when the outer modal closes first', () => {
    const original = document.body.style.overflow
    function Harness({ outer }: { outer: boolean }) {
      return <>
        <DialogSurface open={outer} onClose={vi.fn()} title="Outer">Content</DialogSurface>
        <DialogSurface open onClose={vi.fn()} title="Inner">Content</DialogSurface>
      </>
    }
    const { rerender, unmount } = render(<Harness outer />)
    rerender(<Harness outer={false} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe(original)
  })
})
