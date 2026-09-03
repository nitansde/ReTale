// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextPromptBlocks } from '@/components/graph/context-prompt-blocks'
import { resolveActiveGenerationContextTokenEstimate } from '@/components/graph/context-prompt-block-visibility'
import { estimateTokenCount } from '@/lib/utils'

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

  it('re-estimates the active context when prompt blocks or the current instruction change', () => {
    const blocks = [
      {
        id: 'current-summary',
        label: '当前章节摘要',
        enabled: true,
        priority: 'high' as const,
        content: '# 当前章节摘要\n原摘要',
      },
      {
        id: 'user-instruction',
        label: '任务',
        enabled: true,
        priority: 'highest' as const,
        content: '# 任务\n任务类型：续写后续故事\n用户要求：旧要求第一行\n\n旧要求第二行\n任务要求：接着上下文中给出的已有正文。',
      },
    ]

    expect(resolveActiveGenerationContextTokenEstimate({
      blocks,
      disabledBlockIds: [],
      fallbackTokenEstimate: 123,
      userInstruction: '旧要求第一行\n\n旧要求第二行',
    })).toBe(123)

    const expectedChangedContext = [
      blocks[0].content,
      '# 任务\n任务类型：续写后续故事\n用户要求：新要求\n任务要求：接着上下文中给出的已有正文。',
    ].join('\n\n')
    expect(resolveActiveGenerationContextTokenEstimate({
      blocks,
      disabledBlockIds: [],
      fallbackTokenEstimate: 123,
      userInstruction: '新要求',
    })).toBe(estimateTokenCount(expectedChangedContext))

    expect(resolveActiveGenerationContextTokenEstimate({
      blocks,
      disabledBlockIds: ['current-summary'],
      fallbackTokenEstimate: 123,
      userInstruction: '新要求',
    })).toBe(estimateTokenCount(expectedChangedContext.split('\n\n').slice(1).join('\n\n')))
  })
})
