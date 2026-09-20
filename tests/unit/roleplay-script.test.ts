import { describe, expect, it } from 'vitest'
import { buildRoleplayScriptPrompt, mergeRoleplayNarrationBlocks, parseRoleplayTurn, readGeneratedRoleplayScript, type RoleplayScriptBlock } from '@/lib/roleplay-script'
const turn = { playerName: '甲', counterpartName: '乙', storyGuidance: '雨夜。', dialogue: '走吗？', maxCharacters: 100 }
describe('roleplay scripts', () => {
  it('validates characters, input and target length settings', () => {
    expect(parseRoleplayTurn(turn)).toEqual(turn)
    for (const change of [{ counterpartName: '甲' }, { playerName: '' }, { maxCharacters: 0 }, { maxCharacters: 4001 }, { maxCharacters: 100.5 }, { storyGuidance: '', dialogue: '' }]) expect(parseRoleplayTurn({ ...turn, ...change })).toBeNull()
  })
  it('preserves a complete scene even when the counterpart and ending come after the target length', () => {
    const blocks = [{ type: 'narration', text: '雨落在窗沿。'.repeat(20) }, { type: 'player', text: '他握住伞柄，低声问：“走吗？”' }, { type: 'counterpart', text: '她笑着点头。“好。”' }, { type: 'narration', text: '两人并肩走进雨里。🌧' }]
    const result = readGeneratedRoleplayScript(JSON.stringify({ blocks }), turn)
    expect(result).toEqual({ playerName: '甲', counterpartName: '乙', blocks })
  })
  it('merges adjacent narration paragraphs without moving text across dialogue or mutating input', () => {
    const blocks: RoleplayScriptBlock[] = [
      { type: 'narration', text: '雨声渐近。' },
      { type: 'narration', text: '灯火晃了一下。\n\n屋里静了下来。' },
      { type: 'counterpart', text: '她微微侧过头。“进来吧。”' },
      { type: 'narration', text: '门开了。' },
      { type: 'narration', text: '风跟着涌进来。' },
    ]
    const original = structuredClone(blocks)
    const expected = [
      { type: 'narration', text: '雨声渐近。\n\n灯火晃了一下。\n\n屋里静了下来。' },
      { type: 'counterpart', text: '她微微侧过头。“进来吧。”' },
      { type: 'narration', text: '门开了。\n\n风跟着涌进来。' },
    ]
    expect(mergeRoleplayNarrationBlocks(blocks)).toEqual(expected)
    expect(blocks).toEqual(original)
    expect(readGeneratedRoleplayScript(JSON.stringify({ blocks }), turn)?.blocks).toEqual(expected)
  })
  it('rejects incomplete JSON, unknown types, empty text and replies without the other character', () => {
    for (const content of ['{"blocks":[', '{"blocks":[{"type":"system","text":"x"}]}', '{"blocks":[{"type":"counterpart","text":""}]}', '{"blocks":[{"type":"player","text":"x"}]}', 'raw prose']) expect(readGeneratedRoleplayScript(content, turn)).toBeNull()
  })
  it('guides approximate length and descriptive dialogue with a valid JSON example', () => {
    const prompt = buildRoleplayScriptPrompt(turn)
    expect(prompt).toContain('双方多轮对话和旁白')
    expect(prompt).toContain('目标字数约为 100 字')
    expect(prompt).toContain('允许适当超出或不足')
    expect(prompt).toContain('自然收尾')
    expect(prompt).toContain('不要跨过人物对话合并旁白')
    expect(prompt).toContain('神态、语气、心理反应或伴随的动作描写')
    expect(prompt).toContain('"openingDialogue":"走吗？"')
    expect(prompt).toContain('"storyGuidance":"雨夜。"')
    const example = prompt.split('\n').find((line) => line.startsWith('只返回 JSON 对象 '))!.slice('只返回 JSON 对象 '.length, -1)
    expect(readGeneratedRoleplayScript(example, turn)?.blocks).toHaveLength(3)
  })
})
