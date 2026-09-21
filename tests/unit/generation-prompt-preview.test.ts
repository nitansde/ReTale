import { describe, expect, it } from 'vitest'
import { buildRequestPromptMessages } from '@/lib/generation-prompt-preview'

describe('final prompt blocks', () => {
  it.each([
    ['', ''],
    ['  System without headings\n\n', 'User without headings\t'],
    ['\nPRESET\n# System\n规则\n', '# 任务\n要求\n\n## 范文\n正文\n### 尾部\n \t'],
    ['# Repeated\nA\n# Repeated\nB\n', '\r\n# CRLF heading\r\n内容\r\n'],
  ])('preserves every character in both provider messages', (system, user) => {
    const messages = buildRequestPromptMessages(system, user)
    expect(messages.map((message) => ({ role: message.role, content: message.blocks.map((block) => block.content).join('') })))
      .toEqual([{ role: 'system', content: system }, { role: 'user', content: user }])
    expect(new Set(messages.flatMap((message) => message.blocks.map((block) => block.id))).size)
      .toBe(messages.reduce((count, message) => count + message.blocks.length, 0))
  })

  it('preserves nested context, changed task/source sections, and preset origins without changing the request', () => {
    const summary = '# 当前章节摘要\n摘要内容\n## 内嵌标题\n摘要尾部'
    const baseUserPrompt = `# 当前章节\n第 1 章\n${summary}\n选中行：1 - 2\n# 原章节起始片段（仅作背景，当前进度见对话历史）\n开场\n# 任务\n最终任务`
    const preset = '# 人设要求\n对 {{user}} 温柔。\n## 其他要求\n保持简短。'
    const user = `${preset.replace('{{user}}', '甲')}\n${baseUserPrompt}\n# 预设尾部\n结束。`
    const mode = '角色互动模式指令'
    const system = `# 预设一\n规则一\n## 预设二\n规则二\n\n${mode}`
    const messages = buildRequestPromptMessages(system, user, {
      modeSystemPrompt: mode, baseUserPrompt, presetUserParts: [preset, '# 预设尾部\n结束。'],
      contextBlocks: [
        { id: 'summary', label: '当前章节摘要', content: summary, enabled: true },
        { id: 'selected-text', label: '选中文本', content: '# 选中文本\n开场', enabled: true },
        { id: 'user-instruction', label: '任务', content: '# 任务\n原始任务', enabled: true },
        { id: 'disabled', label: '禁用摘要', content: summary, enabled: false },
      ],
    })
    expect(messages.map((message) => message.blocks.map((block) => block.content).join(''))).toEqual([system, user])
    const all = messages.flatMap((message) => message.blocks)
    expect(all.find((block) => block.contextBlockId === 'summary')?.content).toBe(summary)
    expect(all.find((block) => block.contextBlockId === 'selected-text')?.content).toContain('原章节起始片段')
    expect(all.find((block) => block.contextBlockId === 'user-instruction')?.content).toContain('最终任务')
    expect(all.some((block) => block.contextBlockId === 'disabled')).toBe(false)
    const presetText = all.filter((block) => block.kind === 'preset').map((block) => block.content).join('')
    expect(presetText).toContain('对 甲 温柔')
    expect(presetText).toContain('预设尾部')
    expect(presetText).not.toContain('选中行')
    expect(presetText).not.toContain(mode)
  })
})
