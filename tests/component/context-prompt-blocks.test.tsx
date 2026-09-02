// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextPromptBlocks } from '@/components/graph/context-prompt-blocks'

describe('ContextPromptBlocks', () => {
  it('collapses long prompt text by default and offers collapse controls after expansion', () => {
    const longContent = [
      '# 前情最近 5 章正文',
      'PREVIEW_START_MARKER',
      ...Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 段完整正文。`),
      'FULL_TEXT_END_MARKER',
    ].join('\n')

    render(
      <ContextPromptBlocks
        blocks={[
          {
            id: 'recent-chapters-full-text',
            label: '前情最近 5 章正文',
            enabled: true,
            priority: 'highest',
            content: longContent,
          },
          {
            id: 'short-context',
            label: '短上下文',
            enabled: true,
            priority: 'medium',
            content: '# 短上下文\n一行内容。',
          },
        ]}
        disabledBlockIds={[]}
        onToggle={vi.fn()}
      />,
    )

    const longText = screen.getByTestId('prompt-block-content-recent-chapters-full-text')
    expect(longText).toHaveTextContent('PREVIEW_START_MARKER')
    expect(longText).not.toHaveTextContent('FULL_TEXT_END_MARKER')
    expect(longText.textContent?.length).toBeLessThan(longContent.length)
    expect(screen.queryByRole('button', { name: /短上下文/ })).not.toBeInTheDocument()

    const expandButton = screen.getByRole('button', { name: '展开全文：前情最近 5 章正文' })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expandButton)

    expect(longText).toHaveTextContent('FULL_TEXT_END_MARKER')
    expect(longText.textContent).toBe(longContent)
    const collapseButtons = screen.getAllByRole('button', { name: /收起全文/ })
    expect(collapseButtons).toHaveLength(2)
    expect(collapseButtons[1]).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapseButtons[1])
    expect(longText).not.toHaveTextContent('FULL_TEXT_END_MARKER')
    expect(longText.textContent?.length).toBeLessThan(longContent.length)
    expect(screen.getByRole('button', { name: '展开全文：前情最近 5 章正文' })).toHaveAttribute('aria-expanded', 'false')
  })
})
