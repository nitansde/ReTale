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
    expect(prompt).toContain('appearance 指肩部以上外观')
    expect(prompt).toContain('body 指肩部以下或整体身体')
    expect(prompt).toContain('临时伤势、疲惫、疼痛、无法站起、脸色苍白')
    expect(prompt).toContain('content 写“没有变化”')
    expect(prompt).toContain('{ content, note?, evidence? }')
    expect(prompt).toContain('characters 条目不要输出 status')
    expect(prompt).toContain('每项只能是 { alias, target }')
    expect(prompt).toContain('男人、女人、他、她、那人')
    expect(prompt).toContain('surface_text 必须保留原始称呼')
    expect(prompt).toContain('worldbuilding 每项必须包含 term、category、definition、evidence')
    expect(prompt).not.toContain('"status":"活跃"')
  })

  it('includes the full chapter text instead of a 60-line excerpt', () => {
    const rawText = Array.from({ length: 65 }, (_, index) => `第 ${index + 1} 行`).join('\n')
    const prompt = buildKnowledgeExtractionPrompt('第1章', 1, rawText)

    expect(prompt).toContain('本次提供完整章节内容。')
    expect(prompt).not.toContain('前 60 行节选')
    expect(prompt).toContain('65: 第 65 行')
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
            appearance: { content: '没有变化' },
            body: { content: '没有变化' },
            clothing: { content: '黑袍下摆被火燎破' },
          },
          evidence: [{ quote: '他的黑袍下摆被火燎破。', line_start: 3, line_end: 3 }],
        },
      ],
      unknown_character_observations: [
        {
          surface_text: '灰袍老人',
          observation: '灰袍老人拄杖而来，嗓音沙哑',
          profile: {
            appearance: { content: '灰袍老人' },
            speakingStyle: { content: '嗓音沙哑' },
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
          appearance: { content: '没有变化' },
          body: { content: '没有变化' },
          clothing: { content: '黑袍下摆被火燎破' },
        },
        evidence: [{ quote: '他的黑袍下摆被火燎破。', lineStart: 3, lineEnd: 3 }],
      },
    ])
    expect(extraction.unknownCharacterObservations).toEqual([
      {
        surfaceText: '灰袍老人',
        observation: '灰袍老人拄杖而来，嗓音沙哑',
        profile: {
          appearance: { content: '灰袍老人' },
          speakingStyle: { content: '嗓音沙哑' },
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
        appearance: { content: '高鼻深目' },
        body: { content: '身形瘦高' },
        clothing: { content: '黑色长袍' },
        identity: { content: '执事' },
      },
      {
        appearance: { content: '没有变化' },
        body: { content: '没有变化' },
        clothing: { content: '没有变化' },
        identity: { content: '教团执事' },
      },
    )

    expect(merged).toEqual({
      appearance: { content: '高鼻深目' },
      body: { content: '身形瘦高' },
      clothing: { content: '黑色长袍' },
      identity: { content: '教团执事' },
    })
  })

  it('deduplicates and merges non-visual profile facets instead of overwriting', () => {
    const merged = mergeCharacterRoleCardProfiles(
      {
        identity: { content: '来自示例村的学员；训练营的资深成员' },
        capability: { content: '曾在训练中完成基础挑战' },
        speakingStyle: { content: '自我反思且带有疑惑的口气' },
      },
      {
        identity: { content: '背景待确认；训练营的资深成员' },
        capability: { content: '交还练习工具，获得新的训练器材' },
        speakingStyle: { content: '语气带有疑惑' },
      },
    )

    expect(merged).toEqual({
      identity: { content: '来自示例村的学员；训练营的资深成员；背景待确认' },
      capability: { content: '曾在训练中完成基础挑战；交还练习工具，获得新的训练器材' },
      speakingStyle: { content: '自我反思且带有疑惑的口气' },
    })
  })

  it('keeps detailed appearance, body, and clothing when incoming text is only brief', () => {
    const merged = mergeCharacterRoleCardProfiles(
      {
        appearance: { content: '眉眼狭长，鼻梁高挺，左眼下有一道很浅的旧疤。' },
        body: { content: '身形高瘦，肩背挺直，走动时步幅很轻。' },
        clothing: { content: '身着暗金纹路的黑色长袍，袖口以银线绣着细密符纹。' },
      },
      {
        appearance: { content: '相貌俊秀' },
        body: { content: '身形高瘦' },
        clothing: { content: '身着华服' },
      },
    )

    expect(merged).toEqual({
      appearance: { content: '眉眼狭长，鼻梁高挺，左眼下有一道很浅的旧疤' },
      body: { content: '身形高瘦，肩背挺直，走动时步幅很轻' },
      clothing: { content: '身着暗金纹路的黑色长袍，袖口以银线绣着细密符纹' },
    })
  })

  it('keeps short stable visual details while ignoring generic brief replacements', () => {
    const merged = mergeCharacterRoleCardProfiles(
      {
        appearance: { content: '黑发青年' },
        body: { content: '身形高瘦，肩背挺直' },
        clothing: { content: '黑色长袍' },
      },
      {
        appearance: { content: '相貌俊秀，湛蓝色双眼' },
        body: { content: '动作不够灵活，四肢健全' },
        clothing: { content: '身着华服，戴银戒指' },
      },
    )

    expect(merged).toEqual({
      appearance: { content: '黑发青年；湛蓝色双眼' },
      body: { content: '身形高瘦，肩背挺直；四肢健全' },
      clothing: { content: '黑色长袍；戴银戒指' },
    })
  })

  it('uses the more detailed version for appearance, body, and clothing', () => {
    const merged = mergeCharacterRoleCardProfiles(
      {
        appearance: { content: '黑发青年' },
        body: { content: '肩背挺直' },
        clothing: { content: '白袍' },
      },
      {
        appearance: { content: '黑发青年，黑色短发整齐地梳在耳后，表情担心且认真' },
        body: { content: '肩背挺直，步伐轻捷' },
        clothing: { content: '穿着白袍，袖口干净整齐' },
      },
    )

    expect(merged).toEqual({
      appearance: { content: '黑发青年，黑色短发整齐地梳在耳后' },
      body: { content: '肩背挺直，步伐轻捷' },
      clothing: { content: '穿着白袍，袖口干净整齐' },
    })
  })

  it('filters temporary physical states from role-card visual facets', () => {
    const extraction = normalizeKnowledgeExtraction({
      chapter_no: 8,
      summary: 'summary',
      characters: [
        {
          name: '苏宁',
          aliases: [],
          description_delta: '临时虚弱',
          profile: {
            appearance: { content: '黑发青年，表情担心且认真，脸色苍白' },
            body: { content: '全身软软的，无法站起，脸色苍白，右手臂脱臼' },
            clothing: { content: '白袍' },
            speakingStyle: { content: '带着担心和认真的表情；不多言，专注观察' },
          },
          evidence: [{ quote: '苏宁练习后全身无力，无法站起。', line_start: 1, line_end: 1 }],
        },
      ],
      known_character_updates: [],
      unknown_character_observations: [],
      alias_discoveries: [],
      relations: [],
      events: [],
      worldbuilding: [],
      open_threads: [],
    }, 8)

    expect(extraction.characters[0]?.profile).toEqual({
      appearance: { content: '黑发青年' },
      clothing: { content: '白袍' },
      speakingStyle: { content: '不多言，专注观察' },
    })
  })

  it('filters synthetic temporary role-card fragments from visual facets', () => {
    const firstSampleProfile = mergeCharacterRoleCardProfiles(
      {
        appearance: { content: '左侧眉梢有一道浅浅的旧疤，正在门边靠在墙上，闭目养神' },
        body: { content: '肩背宽阔的体形，穿着训练用的皮革盔甲，左肩缠着绷带，左臂无法活动，四肢健全' },
      },
      {},
    )
    const secondSampleProfile = mergeCharacterRoleCardProfiles(
      {},
      {
        appearance: { content: '黑发青年，面色焦急，双手紧握，表情平静，眼眶红肿，黑发的青年，面上带着悲伤，双手抓紧外套' },
        body: { content: '右手臂脱臼' },
      },
    )
    const thirdSampleProfile = mergeCharacterRoleCardProfiles(
      { appearance: { content: '红发，体形高大' } },
      { body: { content: '已死亡，尸体留在训练场边，被倒塌的道具击飞，撞在木栏后倒地' } },
    )
    const sampleActionProfile = mergeCharacterRoleCardProfiles(
      { appearance: { content: '黑发青年' } },
      { body: { content: '捂着红肿的面颊，双手紧抓外套' } },
    )
    const recoveryProfile = mergeCharacterRoleCardProfiles(
      { body: { content: '四肢健全' } },
      { body: { content: '呼吸困难已好转，呼吸均匀' } },
    )
    const impaledProfile = mergeCharacterRoleCardProfiles(
      { appearance: { content: '红发，体形高大' } },
      { body: { content: '右臂卡在训练装置中，小腹受伤，无法活动' } },
    )
    const limitedMovementProfile = mergeCharacterRoleCardProfiles(
      { body: { content: '四肢健全' } },
      { body: { content: '左臂几乎无法活动' } },
    )
    const discoveredBodyProfile = mergeCharacterRoleCardProfiles(
      { appearance: { content: '红发，体形高大' } },
      { body: { content: '后被发现身影' } },
    )

    expect(firstSampleProfile).toEqual({
      appearance: { content: '左侧眉梢有一道浅浅的旧疤' },
      body: { content: '肩背宽阔的体形，穿着训练用的皮革盔甲，四肢健全' },
    })
    expect(secondSampleProfile).toEqual({
      appearance: { content: '黑发青年，黑发的青年' },
    })
    expect(thirdSampleProfile).toEqual({
      appearance: { content: '红发，体形高大' },
    })
    expect(sampleActionProfile).toEqual({
      appearance: { content: '黑发青年' },
    })
    expect(recoveryProfile).toEqual({
      body: { content: '四肢健全' },
    })
    expect(impaledProfile).toEqual({
      appearance: { content: '红发，体形高大' },
    })
    expect(limitedMovementProfile).toEqual({
      body: { content: '四肢健全' },
    })
    expect(discoveredBodyProfile).toEqual({
      appearance: { content: '红发，体形高大' },
    })
  })

  it('does not merge temporary body states into an existing role card', () => {
    const merged = mergeCharacterRoleCardProfiles(
      {
        appearance: { content: '黑发青年，湛蓝色双眼' },
        clothing: { content: '白袍' },
      },
      {
        appearance: { content: '黑发青年，表情担心且认真，脸色苍白' },
        body: { content: '全身软软的，无法站起，脸色苍白' },
      },
    )

    expect(merged).toEqual({
      appearance: { content: '黑发青年，湛蓝色双眼' },
      clothing: { content: '白袍' },
    })
  })
})
