import { describe, expect, it } from 'vitest'

import { importNovelIntoWorkspace } from '@/lib/server/import-txt'
import { createEmptyWorkspaceState } from '@/lib/workspace-state'

function importChapters(text: string) {
  return importNovelIntoWorkspace(createEmptyWorkspaceState(), { title: 'Fixture', text }).localChapters
}

function importTitles(text: string) {
  return importChapters(text).map((chapter) => chapter.title)
}

describe('TXT import chapter splitting', () => {
  it('splits a heading-first text the same way on every import', () => {
    const text = '第1章 开端\n正文一\n　　第2章 转折\n正文二'
    // A module-level /g regex used with .test() advanced lastIndex across requests.
    expect(importTitles(text)).toEqual(['第1章 开端', '第2章 转折'])
    expect(importTitles(text)).toEqual(['第1章 开端', '第2章 转折'])
  })

  it('does not start a chapter at a heading-like phrase inside a paragraph', () => {
    expect(importTitles('简介\n第1章 开端\n他想起第一章说过的话，继续前行。\n第2章 转折\n正文')).toEqual(['序章 / 简介', '第1章 开端', '第2章 转折'])
  })

  it('keeps volume markers and brackets that share the heading line', () => {
    expect(importTitles('第一卷 风起 第一章 少年\n正文\n第一卷第二章 出发\n正文\n正文 第3章 归来\n正文\n【第4章】终局\n正文')).toEqual([
      '第一卷 风起 第一章 少年',
      '第一卷第二章 出发',
      '正文 第3章 归来',
      '【第4章】终局',
    ])
  })

  it('keeps heading and body pairs aligned when a chapter has no body', () => {
    const chapters = importChapters('第1章 空章\n第2章 有内容\n这里才是正文')
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第1章 空章', '第2章 有内容'])
    expect(chapters[1].content).toContain('这里才是正文')
  })

  it('keeps a long paragraph that opens with a chapter number in the body', () => {
    const paragraph = `第三章的内容我已经看过了，${'海雾从码头漫上来，林舟把信折好放进口袋。'.repeat(4)}`
    const chapters = importChapters(`第1章 开端\n${paragraph}\n第2章 转折\n正文`)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第1章 开端', '第2章 转折'])
    expect(chapters[0].content).toContain('第三章的内容')
  })

  it('falls back to a single chapter when the text has no headings', () => {
    expect(importTitles('没有任何章节标题的正文')).toEqual(['第1章 导入正文'])
  })
})
