import { describe, expect, it } from 'vitest'
import { AsrTranscript } from '@/lib/server/voice/asr'
import { readVoiceEvents, speakableText, splitVoicePhrases, usesDialogueQuotes, type VoiceEvent } from '@/lib/voice-chat'
import { parseRoleplayScript, roleplayScriptText } from '@/lib/roleplay-script'

describe('voice transcripts and incremental framing', () => {
  it('drops descriptions from speech, including brackets that span sentences', () => {
    expect(speakableText('（她笑了笑）你来了。')).toBe('你来了。')
    expect(speakableText('*点头*好。(sigh) 【旁白】走吧。')).toBe('好。 走吧。')
    const state = { depth: 0, star: false, quote: 0, quoted: false }
    expect(['（她叹了口气。', '又笑了。）', '好吧。'].map((phrase) => speakableText(phrase, state))).toEqual(['', '', '好吧。'])
    expect(speakableText('你说的那个“宝贝”在哪？')).toBe('你说的那个宝贝在哪？')
  })
  it('speaks only quoted dialogue once a reply uses dialogue quotes', () => {
    for (const text of ['她转身道：「走吧。」', '她点头，“好。”', '「舒服。」', '她转身。\n"走吧。"']) expect(usesDialogueQuotes(text)).toBe(true)
    expect(usesDialogueQuotes('你说的那个“宝贝”在哪？')).toBe(false)
    const state = { depth: 0, star: false, quote: 0, quoted: true }
    expect(['她转身道：「走吧。', '别回头。」', '她笑了。', '「（低声）快点。」'].map((phrase) => speakableText(phrase, state))).toEqual(['走吧。', '别回头。', '', '快点。'])
  })
  it('commits Soniox final tokens exactly once, replaces provisional tokens, and waits for endpoint', () => {
    const events: VoiceEvent[] = []
    const asr = new AsrTranscript('soniox', (event) => events.push(event))
    asr.accept({ tokens: [{ text: '你', is_final: false }] })
    asr.accept({ tokens: [{ text: '你好', is_final: true }, { text: '玛', is_final: false }] })
    expect(events.filter((event) => event.type === 'transcript' && event.final)).toHaveLength(0)
    asr.accept({ tokens: [{ text: '吗？', is_final: true }, { text: '<end>', is_final: true }] })
    asr.accept({ tokens: [{ text: '再见。', is_final: true }, { text: '<end>', is_final: true }] })
    expect(events.filter((event) => event.type === 'transcript' && event.final)).toEqual([
      { type: 'transcript', text: '你好吗？', final: true }, { type: 'transcript', text: '再见。', final: true },
    ])
    expect(events.filter((event) => event.type === 'speech')).toHaveLength(2)
  })
  it('combines Qwen text/stash and deduplicates final item events', () => {
    const events: VoiceEvent[] = []
    const asr = new AsrTranscript('qwen', (event) => events.push(event))
    asr.accept({ type: 'input_audio_buffer.speech_started' })
    asr.accept({ type: 'conversation.item.input_audio_transcription.text', text: '今天', stash: '下雨' })
    const complete = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'a', transcript: '今天下雨了。' }
    asr.accept(complete); asr.accept(complete)
    expect(events).toEqual([{ type: 'speech' }, { type: 'transcript', text: '今天下雨', final: false }, { type: 'transcript', text: '今天下雨了。', final: true }])
  })
  it('reads split UTF-8 and split event frames without losing text', async () => {
    const data = new TextEncoder().encode(`${JSON.stringify({ type: 'text', text: '你好', segment: 0 })}\n${JSON.stringify({ type: 'done' })}\n`)
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close() } })
    const events: VoiceEvent[] = []
    await readVoiceEvents(new Response(stream), (event) => events.push(event))
    expect(events).toEqual([{ type: 'text', text: '你好', segment: 0 }, { type: 'done' }])
    await expect(readVoiceEvents(new Response('{"type":"done"}'), () => {})).rejects.toThrow('incomplete')
  })
  it('releases the first sentence while retaining the unfinished tail', () => {
    expect(splitVoicePhrases('你好。你在')).toEqual({ phrases: ['你好。'], rest: '你在' })
    expect(splitVoicePhrases('你在哪里？我在这里', true)).toEqual({ phrases: ['你在哪里？', '我在这里'], rest: '' })
    expect(splitVoicePhrases('3.14 is pi. Next')).toEqual({ phrases: ['3.14 is pi.'], rest: ' Next' })
    expect(splitVoicePhrases('It costs 3.')).toEqual({ phrases: [], rest: 'It costs 3.' })
    expect(splitVoicePhrases('It costs 3.', true)).toEqual({ phrases: ['It costs 3.'], rest: '' })
    // Fish returns zero bytes for punctuation-only text; never send it on its own.
    expect(splitVoicePhrases('「真的？！」你回来了。……', true)).toEqual({ phrases: ['「真的？！」', '你回来了。'], rest: '' })
    expect(splitVoicePhrases('真的？')).toEqual({ phrases: [], rest: '真的？' })
  })
  it('preserves interruption metadata through storage', () => {
    const cast = { playerName: '林舟', counterpartName: '沈月' }
    const script = parseRoleplayScript({ ...cast, dialogueOnly: true, voiceInterrupted: true, blocks: [{ type: 'counterpart', text: '你好。' }] })!
    expect(script.voiceInterrupted).toBe(true)
    expect(roleplayScriptText(script)).toContain('以上仅包含已完整播放的句子')
    expect(parseRoleplayScript({ ...script, voiceInterrupted: 'yes' })).toBeNull()
  })
})
