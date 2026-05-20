import { describe, expect, it } from 'vitest'

import { buildKnowledgeExtractionPrompt, normalizeKnowledgeExtraction } from '@/lib/server/ollama-local'
import { mergeCharacterRoleCardProfiles } from '@/lib/story-knowledge'

describe('knowledge extraction prompt', () => {
  it('requests the new structured update and alias fields', () => {
    const prompt = buildKnowledgeExtractionPrompt('第1章', 1, '林澄看见了老周。', 'full', '已知人物：周执事（别名：老周）')

    expect(prompt).toContain('known_character_updates')
    expect(prompt).toContain('unknown_character_observations')
    expect(prompt).toContain('alias_discoveries')
    expect(prompt).toContain('appearance、body、clothing')
    expect(prompt).toContain('summary 明确写“没有变化”')
    expect(prompt).toContain('每项只能是 { alias, target }')
    expect(prompt).toContain('男人、女人、他、她、那人')
    expect(prompt).toContain('surface_text 必须保留原始称呼')
  })

  it('preserves explicit HanLP prompt context inside the extraction prompt body', () => {
    const prompt = buildKnowledgeExtractionPrompt(
      '第2章',
      2,
      '阿离和老周走进北京黑塔。',
      'full',
      [
        '截至第 1 章的故事状态',
        'HanLP 当前章节实体提示（仅作称呼判别与本章背景补充，不能替代原文证据）：',
        '- Tier 1 重要配角：周执事（别名：老周）',
        '- HanLP 地点词：北京',
        '- HanLP 组织词：黑塔',
      ].join('\n'),
    )

    expect(prompt).toContain('HanLP 当前章节实体提示')
    expect(prompt).toContain('Tier 1 重要配角：周执事（别名：老周）')
    expect(prompt).toContain('HanLP 地点词：北京')
    expect(prompt).toContain('HanLP 组织词：黑塔')
  })
})

describe('knowledge extraction normalization', () => {
  it('normalizes known updates, unknown observations, and minimal alias discoveries', () => {
    const extraction = normalizeKnowledgeExtraction({
      chapter_no: 7,
      summary: 'summary',
      characters: [],
      known_character_updates: [
        {
          name: '周执事',
          description_delta: '黑袍下摆被火燎破',
          profile: {
            appearance: { summary: '没有变化' },
            body: { summary: '没有变化' },
            clothing: { summary: '黑袍下摆被火燎破' },
          },
          evidence: [{ quote: '他的黑袍下摆被火燎破。', line_start: 3, line_end: 3 }],
        },
      ],
      unknown_character_observations: [
        {
          surface_text: '灰袍老人',
          observation: '灰袍老人拄杖而来，嗓音沙哑',
          profile: {
            appearance: { summary: '灰袍老人' },
            speakingStyle: { summary: '嗓音沙哑' },
          },
          evidence: [{ quote: '那灰袍老人拄杖而来，嗓音沙哑。', line_start: 8, line_end: 8 }],
        },
      ],
      alias_discoveries: [
        { alias: '老周', target: '周执事', alias_type: 'explicit', valid_from_chapter: 7 },
        { alias: '男人', target: '周执事' },
        { alias: '她', target: '苏青' },
        { alias: '', target: '空' },
        { alias: '同名', target: '同名' },
      ],
      relations: [],
      events: [],
      worldbuilding: [],
      open_threads: [],
    }, 7)

    expect(extraction.knownCharacterUpdates).toEqual([
      {
        name: '周执事',
        descriptionDelta: '黑袍下摆被火燎破',
        profile: {
          appearance: { summary: '没有变化' },
          body: { summary: '没有变化' },
          clothing: { summary: '黑袍下摆被火燎破' },
        },
        evidence: [{ quote: '他的黑袍下摆被火燎破。', lineStart: 3, lineEnd: 3 }],
      },
    ])
    expect(extraction.unknownCharacterObservations).toEqual([
      {
        surfaceText: '灰袍老人',
        observation: '灰袍老人拄杖而来，嗓音沙哑',
        profile: {
          appearance: { summary: '灰袍老人' },
          speakingStyle: { summary: '嗓音沙哑' },
        },
        evidence: [{ quote: '那灰袍老人拄杖而来，嗓音沙哑。', lineStart: 8, lineEnd: 8 }],
      },
    ])
    expect(extraction.aliasDiscoveries).toEqual([
      { alias: '老周', target: '周执事' },
    ])
  })

  it('treats 没有变化 as a merge no-op for appearance, body, and clothing', () => {
    const merged = mergeCharacterRoleCardProfiles(
      {
        appearance: { summary: '高鼻深目' },
        body: { summary: '身形瘦高' },
        clothing: { summary: '黑色长袍' },
        identity: { summary: '执事' },
      },
      {
        appearance: { summary: '没有变化' },
        body: { summary: '没有变化' },
        clothing: { summary: '没有变化' },
        identity: { summary: '教团执事' },
      },
    )

    expect(merged).toEqual({
      appearance: { summary: '高鼻深目' },
      body: { summary: '身形瘦高' },
      clothing: { summary: '黑色长袍' },
      identity: { summary: '执事' },
    })
  })
})
