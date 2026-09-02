// @vitest-environment jsdom

import { createRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { IconButton } from '@/components/ui/IconButton'
import { Notice } from '@/components/ui/Notice'

describe('UI interaction primitives', () => {
  it('requires a labelled 44px icon button target', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<IconButton ref={ref} label="Close"><span>×</span></IconButton>)

    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('min-h-11', 'min-w-11')
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('uses polite status semantics except for assertive errors', () => {
    const { rerender } = render(<Notice>Ready</Notice>)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')

    rerender(<Notice variant="error" action={<button type="button">Retry</button>}>Failed</Notice>)
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('labels modal dialogs, traps focus, closes by Escape and restores focus', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <>
        <button type="button">Opener</button>
        <DialogSurface open={false} onClose={onClose} title="Details" description="More information">
          <button type="button">First</button>
          <button type="button">Last</button>
        </DialogSurface>
      </>
    )
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()

    rerender(
      <>
        <button type="button">Opener</button>
        <DialogSurface open onClose={onClose} title="Details" description="More information">
          <button type="button">First</button>
          <button type="button">Last</button>
        </DialogSurface>
      </>
    )

    const dialog = screen.getByRole('dialog', { name: 'Details', description: 'More information' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()

    screen.getByRole('button', { name: 'Last' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()

    opener.focus()
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<button type="button">Opener</button>)
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps dialog focus stable when a parent rerender replaces the close callback', () => {
    const firstOnClose = vi.fn()
    const latestOnClose = vi.fn()
    const renderDialog = (onClose: () => void) => (
      <DialogSurface open onClose={onClose} title="Settings">
        <button type="button">First</button>
        <button type="button">Current control</button>
      </DialogSurface>
    )
    const { rerender } = render(renderDialog(firstOnClose))
    const currentControl = screen.getByRole('button', { name: 'Current control' })
    currentControl.focus()

    rerender(renderDialog(latestOnClose))

    expect(currentControl).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(firstOnClose).not.toHaveBeenCalled()
    expect(latestOnClose).toHaveBeenCalledTimes(1)
  })

  it('uses an explicit initial focus target and restores the opener after closing', () => {
    const onClose = vi.fn()
    const inputRef = createRef<HTMLInputElement>()
    const renderDialog = (open: boolean) => (
      <>
        <button type="button">Edit metadata</button>
        <DialogSurface open={open} onClose={onClose} title="Metadata" closeLabel="Close" initialFocusRef={inputRef}>
          <input ref={inputRef} aria-label="Title" />
        </DialogSurface>
      </>
    )
    const { rerender } = render(renderDialog(false))
    const opener = screen.getByRole('button', { name: 'Edit metadata' })
    opener.focus()

    rerender(renderDialog(true))

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(renderDialog(false))
    expect(opener).toHaveFocus()
  })

  it('supports backdrop close and destructive confirmation', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete data"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const backdrop = screen.getByRole('dialog').parentElement!
    fireEvent.mouseDown(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseUp(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismisses only on a direct backdrop click without exposing underlying editable content', () => {
    const onClose = vi.fn()
    const onUnderlyingEdit = vi.fn()

    function Harness() {
      const [open, setOpen] = useState(false)
      const [editorText, setEditorText] = useState('Original text')

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open directory</button>
          <div
            role="textbox"
            aria-label="Underlying editor"
            contentEditable
            suppressContentEditableWarning
            onClick={() => {
              onUnderlyingEdit()
              setEditorText('Mutated text')
            }}
          >
            {editorText}
          </div>
          <DialogSurface
            open={open}
            onClose={() => {
              onClose()
              setOpen(false)
            }}
            title="Chapter directory"
            placement="left"
          >
            <button type="button">Inside control</button>
          </DialogSurface>
        </>
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open directory' }))

    const dialog = screen.getByRole('dialog', { name: 'Chapter directory' })
    const backdrop = dialog.parentElement!
    fireEvent.mouseDown(backdrop)
    expect(dialog).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseUp(backdrop)
    expect(dialog).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Inside control' }))
    expect(dialog).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Chapter directory' })).not.toBeInTheDocument()
    expect(onUnderlyingEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Underlying editor' })).toHaveTextContent('Original text')
  })

  it('locks busy confirmations against repeat submission, Escape, and backdrop cancellation', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const renderDialog = (busy: boolean) => (
      <ConfirmDialog
        open
        busy={busy}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete data"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    )
    const { rerender } = render(renderDialog(false))

    const confirmButton = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    rerender(renderDialog(true))
    const dialog = screen.getByRole('dialog', { name: 'Delete data' })
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(dialog.parentElement!)
    fireEvent.mouseUp(dialog.parentElement!)
    fireEvent.click(dialog.parentElement!)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    rerender(renderDialog(false))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
