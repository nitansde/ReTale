// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AdvancedContextPromptPanel } from '@/components/graph/advanced-context-prompt-panel'
import { buildRequestPromptMessages } from '@/lib/generation-prompt-preview'

afterEach(cleanup)

const blocks = [
  { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high' as const, content: '# 当前章节摘要\n摘要内容\n## 内嵌小节\n摘要尾部' },
  { id: 'user-instruction', label: '任务', enabled: true, priority: 'highest' as const, content: '# 任务\n原始任务', required: true },
]

it('merges request-only instructions with context controls, showing each source once and one collapsible preset', () => {
  const onToggle = vi.fn()
  const system = '开头 system 指令\n# 预设规则\n' + '规则正文\n'.repeat(30) + '# 输出格式\nSYSTEM_END'
  const baseUserPrompt = `# 当前章节\n第 1 章\n${blocks[0].content}\n# 任务\n最终任务指令`
  const userPreset = '# 额外预设\nUSER_PRESET_END'
  render(<AdvancedContextPromptPanel blocks={blocks} disabledBlockIds={[]} onToggle={onToggle}
    requestMessages={buildRequestPromptMessages(system, `${userPreset}\n${baseUserPrompt}`, {
      contextBlocks: blocks, baseUserPrompt, presetUserParts: [userPreset],
    })} />)
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.getAllByTestId('context-prompt-blocks')).toHaveLength(1)
  const displayedContents = [...screen.getByTestId('context-prompt-blocks').querySelectorAll('[data-testid^="prompt-block-content-"]')]
  expect(displayedContents.map((element) => element.textContent)).toEqual([
    expect.stringContaining('开头 system 指令'),
    expect.stringContaining('第 1 章'),
    expect.stringContaining('摘要内容'),
    expect.stringContaining('最终任务指令'),
  ])
  expect(screen.getAllByText(/摘要内容/)).toHaveLength(1)
  expect(screen.getAllByText(/摘要尾部/)).toHaveLength(1)
  expect(screen.getByTestId('prompt-block-content-user-instruction')).toHaveTextContent('最终任务指令')
  expect(screen.queryByText(/原始任务/)).not.toBeInTheDocument()
  expect(screen.getByText(/第 1 章/)).toBeVisible()
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  expect(screen.getByRole('checkbox', { name: '任务' })).toBeDisabled()
  const preset = screen.getByTestId('prompt-block-content-request-preset')
  expect(preset).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '展开全文：预设' }))
  expect(preset).toBeVisible()
  expect(preset).toHaveTextContent('SYSTEM_END')
  expect(preset).toHaveTextContent('USER_PRESET_END')
  expect(within(preset.closest('article')!).queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '展开全文：输出格式' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '收起全文：预设' }))
  expect(preset).not.toBeVisible()
  fireEvent.click(screen.getByRole('checkbox', { name: '当前章节摘要' }))
  expect(onToggle).toHaveBeenCalledWith('current-summary', false)
})

it('keeps context controls while refreshing and collapses even short presets', () => {
  const props = {
    blocks, disabledBlockIds: [], onToggle: vi.fn(),
    requestMessages: buildRequestPromptMessages('简短预设', '# 当前章节\n旧章节', { contextBlocks: blocks }),
  }
  const view = render(<AdvancedContextPromptPanel {...props} />)
  const preset = screen.getByTestId('prompt-block-content-request-preset')
  expect(preset).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '展开全文：预设' }))
  expect(preset).toBeVisible()
  view.rerender(<AdvancedContextPromptPanel {...props} loading />)
  expect(screen.getByRole('status')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: '当前章节摘要' })).toBeEnabled()
  expect(screen.queryByText(/旧章节/)).not.toBeInTheDocument()
  expect(screen.queryByTestId('prompt-block-content-request-preset')).not.toBeInTheDocument()
  view.rerender(<AdvancedContextPromptPanel {...props} requestMessages={buildRequestPromptMessages('更新预设', '# 当前章节\n新章节')} />)
  expect(screen.getByText(/新章节/)).toBeVisible()
  expect(screen.getByTestId('prompt-block-content-request-preset')).not.toBeVisible()
})

it('keeps disabled and trimmed context available without fabricating request controls', () => {
  render(<AdvancedContextPromptPanel
    blocks={[{ ...blocks[0], enabled: false }, { ...blocks[1], trimmed: true }]}
    disabledBlockIds={['current-summary']} onToggle={vi.fn()}
    requestMessages={buildRequestPromptMessages('', '# 回复契约\n只回复本轮对话。')}
  />)
  expect(screen.getByRole('checkbox', { name: '当前章节摘要' })).not.toBeChecked()
  expect(screen.getByText('超出预设上下文预算，本次未加入')).toBeVisible()
  expect(screen.getByText(/只回复本轮对话/)).toBeVisible()
  expect(screen.queryByRole('checkbox', { name: '回复契约' })).not.toBeInTheDocument()
})
