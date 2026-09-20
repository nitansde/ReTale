export type RoleplayCast = { playerName: string; counterpartName: string }
// maxCharacters is the stored field name; it is an advisory target, not an output cap.
export type RoleplayTurn = RoleplayCast & { storyGuidance: string; dialogue: string; maxCharacters: number; generationOptions?: RoleplayGenerationOptions }
export type RoleplayScriptBlock = { type: 'narration' | 'player' | 'counterpart'; text: string }
export type RoleplayScript = RoleplayCast & { blocks: RoleplayScriptBlock[] }
export type RoleplayCharacterOption = { name: string; protagonist: boolean }

export const ROLEPLAY_DEFAULT_LENGTH = 600

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseRoleplayCast(value: unknown): RoleplayCast | null {
  const input = record(value)
  if (!input || typeof input.playerName !== 'string' || typeof input.counterpartName !== 'string') return null
  const playerName = input.playerName.trim()
  const counterpartName = input.counterpartName.trim()
  if (!playerName || !counterpartName || playerName.length > 80 || counterpartName.length > 80 || playerName === counterpartName) return null
  return { playerName, counterpartName }
}

export function parseRoleplayTurn(value: unknown, options: { allowEmptyInput?: boolean } = {}): RoleplayTurn | null {
  const input = record(value)
  const cast = parseRoleplayCast(value)
  if (!input || !cast || typeof input.storyGuidance !== 'string' || typeof input.dialogue !== 'string') return null
  const storyGuidance = input.storyGuidance.trim()
  const dialogue = input.dialogue.trim()
  if ((!options.allowEmptyInput && !storyGuidance && !dialogue) || storyGuidance.length > 10000 || dialogue.length > 10000) return null
  const maxCharacters = input.maxCharacters
  if (typeof maxCharacters !== 'number' || !Number.isInteger(maxCharacters) || maxCharacters < 100 || maxCharacters > 4000) return null
  const generationOptions = input.generationOptions === undefined ? undefined : parseRoleplayGenerationOptions(input.generationOptions)
  if (generationOptions === null) return null
  return { ...cast, storyGuidance, dialogue, maxCharacters, ...(generationOptions ? { generationOptions } : {}) }
}

function parseBlocks(value: unknown): RoleplayScriptBlock[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 200) return null
  const blocks: RoleplayScriptBlock[] = []
  for (const item of value) {
    const block = record(item)
    if (!block || !['narration', 'player', 'counterpart'].includes(String(block.type)) || typeof block.text !== 'string' || !block.text.trim()) return null
    blocks.push({ type: block.type as RoleplayScriptBlock['type'], text: block.text.trim() })
  }
  return mergeRoleplayNarrationBlocks(blocks)
}

export function mergeRoleplayNarrationBlocks(blocks: readonly RoleplayScriptBlock[]): RoleplayScriptBlock[] {
  const merged: RoleplayScriptBlock[] = []
  for (const block of blocks) {
    const previous = merged.at(-1)
    if (block.type === 'narration' && previous?.type === 'narration') {
      previous.text += `\n\n${block.text}`
    } else {
      merged.push({ ...block })
    }
  }
  return merged
}

export function parseRoleplayScript(value: unknown): RoleplayScript | null {
  const input = record(value)
  const cast = parseRoleplayCast(value)
  const blocks = parseBlocks(input?.blocks)
  return cast && blocks ? { ...cast, blocks } : null
}

export function readGeneratedRoleplayScript(content: string, turn: RoleplayTurn): RoleplayScript | null {
  try {
    const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const value: unknown = JSON.parse(clean)
    const blocks = parseBlocks(Array.isArray(value) ? value : record(value)?.blocks)
    if (!blocks || !blocks.some((block) => block.type === 'counterpart')) return null
    return { playerName: turn.playerName, counterpartName: turn.counterpartName, blocks }
  } catch { return null }
}

export function roleplayScriptText(script: RoleplayScript) {
  return script.blocks.map((block) => `${block.type === 'narration' ? '旁白' : block.type === 'player' ? script.playerName : script.counterpartName}：${block.text}`).join('\n\n')
}

export function roleplayTurnText(turn: RoleplayTurn) {
  return [turn.storyGuidance && `故事引导：${turn.storyGuidance}`, turn.dialogue && `${turn.playerName}对${turn.counterpartName}说：${turn.dialogue}`].filter(Boolean).join('\n')
}

export const ROLEPLAY_SCRIPT_SYSTEM_PROMPT = [
  '你是视觉小说双角色脚本生成器。本次输出必须遵守 Galgame 脚本契约，返回含 narration、player、counterpart 的 JSON blocks；不采用小说正文输出格式。允许代写双方后续台词与行动旁白。',
  '已有 RP 历史是当前故事进度，优先承接其中最新的场景、人物状态和对话。原章节仅提供初始背景；即使预设要求魔改原文，也不要将本轮当作重新开场或重写原章节。只生成接下来发生的新内容。',
].join('\n')

export function buildRoleplayScriptPrompt(turn: RoleplayTurn, hasHistory = false) {
  return [
    '# Galgame 双角色脚本契约',
    `用户扮演：${JSON.stringify(turn.playerName)}；互动对象：${JSON.stringify(turn.counterpartName)}。`,
    '根据章节上下文、此前对话和本轮故事引导，生成一段连贯的视觉小说脚本。',
    hasHistory
      ? '这是继续对话：本轮台词接在历史最后一段之后。延续最后的场景、行动、人物关系和未回答的问题，不回到原章节起点、不重复相遇或已经完成的对话；除非用户明确要求跳转场景。'
      : '这是故事的第一轮：从章节起始片段进入用户指定的场景。',
    '用户台词是本段引子，先承接它；允许继续编写双方多轮对话和旁白，形成一小段故事。',
    '可以描写场景、人物行动与反应；保持双方身份、性格与已有关系一致，不使用当前章节之后的事实。',
    '故事引导是场景和行动指令，不是角色说出口的话。不要把引导原样当成台词。',
    `本次故事的目标字数约为 ${turn.maxCharacters} 字（所有块合计，含标点）。请写到这个长度附近；这是篇幅引导，允许适当超出或不足，以情节和句子完整、自然收尾为先，不要为凑字数拖长或突然中断。`,
    '连续的旁白段落合并在同一个 narration 块中，用换行保留段落；不要跨过人物对话合并旁白。',
    'player 和 counterpart 块除了说出口的台词，也可以包含该角色的神态、语气、心理反应或伴随的动作描写，让对话自然生动；同一块始终归属于该角色。环境、整体场面或跨角色的行动放在 narration 中。',
    '只返回 JSON 对象 {"blocks":[{"type":"narration","text":"雨落在窗沿。\\n\\n屋里的灯晃了一下。"},{"type":"player","text":"他抬眼看向她，声音放轻：“还在等我？”"},{"type":"counterpart","text":"她微微一笑，把伞递过去。“当然。”"}]}。',
    'type 只能是 narration、player、counterpart；人物块不加角色名前缀。可重复任意类型，必须包含对方的台词。不输出分析、标题或 Markdown 代码围栏。',
    '# 本轮输入',
    JSON.stringify({ storyGuidance: turn.storyGuidance, openingDialogue: turn.dialogue }),
  ].join('\n')
}
import { parseRoleplayGenerationOptions, type RoleplayGenerationOptions } from '@/lib/roleplay-generation'
