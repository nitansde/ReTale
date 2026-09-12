// @vitest-environment jsdom

import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChapterReaderMode } from '@/components/workspace/use-chapter-reader-mode'

describe('chapter reader mode', () => {
  let editor: Editor

  beforeEach(() => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>A chapter.</p>', editable: false })
  })

  afterEach(() => editor.destroy())

  it('requires explicit editing, resets on navigation, and never dirties the document when toggling', async () => {
    const update = vi.fn()
    editor.on('update', update)
    const save = vi.fn().mockResolvedValue(true)
    const { result, rerender } = renderHook(({ scope }) => useChapterReaderMode(editor, scope, save), {
      initialProps: { scope: 'chapter-1' },
    })
    expect(editor.isEditable).toBe(false)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    act(() => result.current.startEditing())
    expect(editor.isEditable).toBe(true)
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.empty).toBe(true)
    await act(async () => { await result.current.finishEditing() })
    expect(save).toHaveBeenCalledOnce()
    expect(editor.isEditable).toBe(false)
    act(() => result.current.startEditing())
    rerender({ scope: 'chapter-2' })
    expect(editor.isEditable).toBe(false)
    rerender({ scope: 'chapter-1' })
    expect(editor.isEditable).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(editor.getHTML()).toBe('<p>A chapter.</p>')
  })

  it('keeps editing available after a failed save so the user can retry', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { result } = renderHook(() => useChapterReaderMode(editor, 'chapter-1', save))
    act(() => result.current.startEditing())
    await act(async () => { await result.current.finishEditing() })
    expect(result.current.isEditing).toBe(true)
    expect(result.current.isSaving).toBe(false)
    expect(editor.isEditable).toBe(true)
    await act(async () => { await result.current.finishEditing() })
    expect(editor.isEditable).toBe(false)
  })

  it('does not let a previous chapter save close a new editing session', async () => {
    let resolveSave!: (saved: boolean) => void
    const save = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve }))
    const { result, rerender } = renderHook(({ scope }) => useChapterReaderMode(editor, scope, save), {
      initialProps: { scope: 'chapter-1' },
    })
    act(() => result.current.startEditing())
    let pending!: Promise<void>
    act(() => { pending = result.current.finishEditing() })
    expect(result.current.isSaving).toBe(true)
    expect(editor.isEditable).toBe(false)
    rerender({ scope: 'chapter-2' })
    act(() => result.current.startEditing())
    await act(async () => { resolveSave(true); await pending })
    expect(result.current.isEditing).toBe(true)
    expect(editor.isEditable).toBe(true)
  })
})
