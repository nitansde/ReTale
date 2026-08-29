import { describe, expect, it } from 'vitest'
import { buildUserPrompt } from '@/app/api/rewrite/handler'

const baseInput = {
  operationType: 'rewrite',
  userInstruction: '保留剧情，增强压迫感',
  chapterNo: 3,
  selectedLineStart: 10,
  selectedLineEnd: 12,
  sourceText: '章节正文',
  selectedText: '待改写原文',
  assembledContext: '# 当前小说知识库和硬约束\n人物关系与事件结果不得改变。',
}

describe('writing skill rewrite prompt integration', () => {
  it('keeps the original no-card prompt byte-for-byte unchanged', () => {
    expect(buildUserPrompt(baseInput)).toMatchInlineSnapshot(`
      "# 当前章节
      当前章节：第 3 章


      # 当前小说知识库和硬约束
      人物关系与事件结果不得改变。
      选中行：10 - 12
      # 选中文本
      待改写原文

      # 任务
      操作类型：rewrite
      用户要求：保留剧情，增强压迫感"
    `)
  })

  it('places one selected skill card after the task and before source text and output requirements', () => {
    const prompt = buildUserPrompt({
      ...baseInput,
      writingSkillPrompt: '## 本次指定写作技巧：作者甲 · 五官描写\n技巧内容\n不得改变当前小说中已经确定的人物外貌。',
    })
    const contextIndex = prompt.indexOf('# 当前小说知识库和硬约束')
    const taskIndex = prompt.indexOf('# 任务')
    const skillIndex = prompt.indexOf('## 本次指定写作技巧')
    const sourceIndex = prompt.indexOf('# 选中文本')
    const outputIndex = prompt.indexOf('# 输出要求')

    expect(contextIndex).toBeGreaterThanOrEqual(0)
    expect(contextIndex).toBeLessThan(taskIndex)
    expect(taskIndex).toBeLessThan(skillIndex)
    expect(skillIndex).toBeLessThan(sourceIndex)
    expect(sourceIndex).toBeLessThan(outputIndex)
    expect(prompt.match(/## 本次指定写作技巧/g)).toHaveLength(1)
    expect(prompt).toContain('不得改变当前小说中已经确定的人物外貌')
  })
})
