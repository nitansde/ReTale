import { describe, expect, it } from 'vitest'
import { buildUserPrompt } from '@/app/api/rewrite/handler'

const baseInput = {
  operationType: 'rewrite',
  userInstruction: '保留剧情，增强压迫感',
  chapterNo: 3,
  sourceText: '章节正文',
  selectedText: '待改写原文',
  assembledContext: '# 当前小说知识库和硬约束\n人物关系与事件结果不得改变。',
}

describe('writing skill rewrite prompt integration', () => {
  it('includes the source passage directly without standalone line metadata', () => {
    expect(buildUserPrompt(baseInput)).toMatchInlineSnapshot(`
      "# 当前章节
      当前章节：第 3 章


      # 当前小说知识库和硬约束
      人物关系与事件结果不得改变。
      # 选中文本
      待改写原文

      # 任务
      操作类型：rewrite
      用户要求：保留剧情，增强压迫感"
    `)
  })

  it('places sampled skills after source text and before the final task', () => {
    const prompt = buildUserPrompt({
      ...baseInput,
      writingSkillPrompt: '## 本次指定写作技巧：作者甲 · 五官描写\n技巧内容\n不得改变当前小说中已经确定的人物外貌。',
    })
    const contextIndex = prompt.indexOf('# 当前小说知识库和硬约束')
    const taskIndex = prompt.indexOf('# 任务')
    const skillIndex = prompt.indexOf('## 本次指定写作技巧')
    const sourceIndex = prompt.indexOf('# 选中文本')
    const outputIndex = prompt.indexOf('严格遵守当前魔改输出契约')

    expect(contextIndex).toBeGreaterThanOrEqual(0)
    expect(contextIndex).toBeLessThan(sourceIndex)
    expect(sourceIndex).toBeLessThan(skillIndex)
    expect(skillIndex).toBeLessThan(outputIndex)
    expect(outputIndex).toBeLessThan(taskIndex)
    expect(prompt.match(/## 本次指定写作技巧/g)).toHaveLength(1)
    expect(prompt).toContain('不得改变当前小说中已经确定的人物外貌')
  })

  it.each(['rewrite', 'roleplay'])('preserves the full background/history prefix when dynamic content changes (%s)', (operationType) => {
    const roleplayTurn = { playerName: '甲', counterpartName: '乙', storyGuidance: '她将杯子推来。', dialogue: '谢谢，温度正好。', maxCharacters: 600 }
    const input = {
      ...baseInput, operationType,
      ...(operationType === 'roleplay' ? { roleplayTurn, roleplayHistory: '# 当前角色扮演对话\n固定历史内容' } : {}),
      retrievedEvidence: '# Lance 检索证据\n检索甲',
      writingSkillPrompt: '## 本次指定写作技巧：细节\n范文甲',
    }
    const prompt = buildUserPrompt(input)
    const changedTask = buildUserPrompt({
      ...input, userInstruction: '增强喜悦感',
      ...(operationType === 'roleplay' ? { roleplayTurn: { ...roleplayTurn, storyGuidance: '她拉开窗帘。', dialogue: '天晴了。', maxCharacters: 2000 } } : {}),
    })
    const taskStart = prompt.lastIndexOf('# 任务')
    expect(taskStart).toBeGreaterThan(prompt.indexOf('范文甲'))
    expect(changedTask.slice(0, taskStart)).toBe(prompt.slice(0, taskStart))
    expect(changedTask.slice(taskStart)).not.toBe(prompt.slice(taskStart))

    const changedExamples = buildUserPrompt({ ...input, writingSkillPrompt: '## 本次指定写作技巧：细节\n范文乙' })
    const skillStart = prompt.indexOf('## 本次指定写作技巧')
    expect(changedExamples.slice(0, skillStart)).toBe(prompt.slice(0, skillStart))
    expect(changedExamples).toContain('范文乙')
    expect(changedExamples).not.toContain('范文甲')

    const changedEvidence = buildUserPrompt({ ...input, retrievedEvidence: '# Lance 检索证据\n检索乙' })
    const evidenceStart = prompt.indexOf('# Lance 检索证据')
    expect(evidenceStart).toBeGreaterThan(prompt.indexOf('待改写原文'))
    expect(evidenceStart).toBeLessThan(skillStart)
    expect(changedEvidence.slice(0, evidenceStart)).toBe(prompt.slice(0, evidenceStart))
    if (operationType === 'roleplay') {
      expect(evidenceStart).toBeGreaterThan(prompt.indexOf('固定历史内容'))
      expect(prompt.split(roleplayTurn.storyGuidance)).toHaveLength(2)
      expect(prompt.split(roleplayTurn.dialogue)).toHaveLength(2)
      expect(prompt.indexOf('目标字数约为 600 字')).toBeGreaterThan(taskStart)
    }
  })

  it('keeps the existing RP history as a prefix when new messages are appended', () => {
    const roleplayTurn = { playerName: '甲', counterpartName: '乙', storyGuidance: '', dialogue: '开门吧。', maxCharacters: 600 }
    const input = { ...baseInput, operationType: 'roleplay', roleplayTurn, roleplayHistory: '# 当前角色扮演对话\n第一轮故事。' }
    const prompt = buildUserPrompt(input)
    const next = buildUserPrompt({ ...input, roleplayHistory: `${input.roleplayHistory}\n第二轮故事。` })
    const oldHistoryEnd = prompt.indexOf(input.roleplayHistory) + input.roleplayHistory.length
    expect(next.slice(0, oldHistoryEnd)).toBe(prompt.slice(0, oldHistoryEnd))
    const firstTurn = buildUserPrompt({ ...input, roleplayHistory: '' })
    expect(firstTurn.slice(0, prompt.indexOf('# 当前角色扮演对话'))).toBe(prompt.slice(0, prompt.indexOf('# 当前角色扮演对话')))
  })
})
