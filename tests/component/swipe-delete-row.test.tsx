// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwipeDeleteRow } from '@/components/timeline/SwipeDeleteRow'

class TouchPointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  isPrimary: boolean
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'touch'
    this.isPrimary = init.isPrimary ?? true
  }
}

function setup(deleting = false) {
  vi.stubGlobal('PointerEvent', TouchPointerEvent)
  const onDelete = vi.fn()
  const onSelect = vi.fn()
  render(<SwipeDeleteRow data-testid="row" deleteLabel="Delete chapter" onDelete={onDelete} deleting={deleting}>
    <button onClick={onSelect}>Chapter one</button>
  </SwipeDeleteRow>)
  return { onDelete, onSelect, row: screen.getByTestId('row'), card: screen.getByText('Chapter one') }
}

function swipe(card: HTMLElement, dx: number, dy = 0, cancel = false) {
  fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
  fireEvent.pointerMove(card, { clientX: 200 + dx, clientY: 200 + dy })
  if (cancel) fireEvent.pointerCancel(card, { clientX: 200 + dx, clientY: 200 + dy })
  else fireEvent.pointerUp(card, { clientX: 200 + dx, clientY: 200 + dy })
}

afterEach(() => vi.unstubAllGlobals())

describe('SwipeDeleteRow', () => {
  it('reveals deletion without deleting or opening the chapter, including the synthetic click after a swipe', () => {
    const { card, row, onSelect, onDelete } = setup()
    swipe(card, -100)
    fireEvent.click(card)
    expect(row).toHaveAttribute('data-delete-revealed', 'true')
    expect(onSelect).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete chapter' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(row).toHaveAttribute('data-delete-revealed', 'false')
  })

  it.each([[-20, 0, false], [-15, 90, false], [-100, 0, true]] as const)('does not reveal on a short, vertical, or cancelled gesture (%s, %s, %s)', (dx, dy, cancel) => {
    const { card, row, onDelete } = setup()
    swipe(card, dx, dy, cancel)
    expect(row).toHaveAttribute('data-delete-revealed', 'false')
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('closes with a right swipe, Escape, or an outside touch, and preserves ordinary taps', () => {
    const { card, row, onSelect } = setup()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledTimes(1)
    swipe(card, -100)
    swipe(card, 100)
    expect(row).toHaveAttribute('data-delete-revealed', 'false')
    swipe(card, -100)
    fireEvent.keyDown(card, { key: 'Escape' })
    expect(row).toHaveAttribute('data-delete-revealed', 'false')
    swipe(card, -100)
    fireEvent.pointerDown(document.body)
    expect(row).toHaveAttribute('data-delete-revealed', 'false')
  })

  it('closes an open row before selecting it', () => {
    const { card, row, onSelect } = setup()
    swipe(card, -100)
    expect(row).toHaveAttribute('data-delete-revealed', 'true')
    fireEvent.pointerDown(card)
    fireEvent.pointerUp(card)
    fireEvent.click(card)
    expect(row).toHaveAttribute('data-delete-revealed', 'false')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('blocks duplicate deletion and gestures while a delete is pending', () => {
    const { card, row, onDelete } = setup(true)
    swipe(card, -100)
    expect(row).toHaveAttribute('data-delete-revealed', 'false')
    expect(screen.getByRole('button', { name: 'Delete chapter' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete chapter' }))
    expect(onDelete).not.toHaveBeenCalled()
  })
})
