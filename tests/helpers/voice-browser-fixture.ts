import type { Page } from '@playwright/test'

export async function installVoiceBrowserFixture(page: Page) {
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    const encoder = new TextEncoder()
    let asr: ReadableStreamDefaultController<Uint8Array>
    let reply: ReadableStreamDefaultController<Uint8Array>
    const fixture = { audioPackets: 0, audioBytes: 0, tracks: [] as MediaStreamTrack[], traces: [] as { event: string; reason?: string }[],
      say(text: string) { asr.enqueue(encoder.encode(`${JSON.stringify({ type: 'transcript', text, final: true })}\n`)) },
      tail() {
        const events = [
          { type: 'text', segment: 1, text: '这句话还没有完整播完。' },
          { type: 'audio', segment: 1, sampleRate: 24000, audio: btoa('\0'.repeat(24000 * 2 * 20)) },
          { type: 'segment-end', segment: 1 },
        ]
        for (const event of events) reply.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      },
    }
    Object.assign(window, { voiceFixture: fixture })
    // Exercise real Web Audio capture/resampling/playback without a physical mic
    // or paid providers. The generated input is silence, preventing false VAD.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext()
      const destination = context.createMediaStreamDestination()
      const oscillator = context.createOscillator(); const gain = context.createGain(); gain.gain.value = 0
      oscillator.connect(gain); gain.connect(destination); oscillator.start()
      for (const track of destination.stream.getTracks()) {
        fixture.tracks.push(track)
        const stop = track.stop.bind(track)
        track.stop = () => {
          stop()
          try { oscillator.stop() } catch { /* Track cleanup may run twice. */ }
          if (context.state !== 'closed') void context.close().catch(() => undefined)
        }
      }
      return destination.stream
    }
    window.fetch = async (input, init) => {
      const url = String(input)
      // Keep test calls out of the real logs/voice-debug trace; assert on them instead.
      if (url === '/api/roleplay/voice/debug') { fixture.traces.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }) }
      if (url === '/api/roleplay/voice/transcribe') {
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          asr = controller
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'ready', sessionId: 'voice-fixture' })}\n`))
          init?.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Aborted', 'AbortError')) } catch {} })
        } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      if (url.includes('/api/roleplay/voice/transcribe/')) {
        if (init?.method === 'POST') { fixture.audioPackets++; fixture.audioBytes += (init.body as Uint8Array).byteLength }
        return Response.json({ ok: true })
      }
      if (url === '/api/roleplay/voice/reply') {
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          reply = controller
          for (const event of [
            { type: 'text', segment: 0, text: '我在这里。' },
            { type: 'audio', segment: 0, sampleRate: 24000, audio: btoa('\0'.repeat(24000 * 2 / 4)) },
            { type: 'segment-end', segment: 0 },
          ]) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          init?.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Aborted', 'AbortError')) } catch {} })
        } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      return originalFetch(input, init)
    }
  })
}

export async function exerciseVoiceCall(page: Page) {
  await page.getByRole('button', { name: '开始通话' }).click()
  await page.getByText('正在聆听', { exact: true }).waitFor()
  await page.evaluate(() => (window as unknown as { voiceFixture: { say: (text: string) => void } }).voiceFixture.say('你在哪里？'))
  await page.getByText('角色正在说话', { exact: true }).waitFor()
  // Let the 250 ms first sentence finish; keep the second sentence in flight.
  await page.waitForTimeout(600)
  await page.evaluate(() => (window as unknown as { voiceFixture: { tail: () => void } }).voiceFixture.tail())
  await page.getByText('我在这里。这句话还没有完整播完。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '打断回复' }).click()
  await page.getByText('语音已打断', { exact: true }).waitFor()
}
