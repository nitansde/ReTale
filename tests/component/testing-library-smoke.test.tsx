// @vitest-environment jsdom

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

function HarnessBadge() {
  return <button type="button">future-jump harness ready</button>
}

describe('testing-library jsdom harness', () => {
  it('renders React components under jsdom', () => {
    render(<HarnessBadge />)
    expect(screen.getByRole('button', { name: 'future-jump harness ready' })).toBeInTheDocument()
  })
})
