// Records the README GIFs from the demo site (sample books, simulated AI).
// Run from the repository root: node scripts/capture-readme.mjs [name-language ...]
// DEMO_URL points it at another demo build. Needs ffmpeg on PATH.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const demo = (process.env.DEMO_URL || 'https://nitansde.github.io/retale-demo/').replace(/\/?$/, '/')
const output = path.resolve('docs/images')
const only = process.argv.slice(2)
// Lines typed in roleplay must match the demo's script to get its scripted reply.
const labels = {
  zh: {
    book: '退婚当天，我继承了反派宗门', voiceBook: '勇者辞职后，魔王成了我的房东', line: '谢无咎从抽屉里翻出一本账',
    instruction: '让宁知雪当众替矿工作证，师徒关系提前决裂。', say: '秋娘就是方秋娘。伙房每天多煮的那碗粥，是给她失踪的孩子留的，留了十三年。',
    rewrite: '魔改', generate: '生成版本', nav: '打开章节导航', context: '打开故事上下文', more: '更多选项', graph: '图谱', map: '图谱',
    dialogue: '我的台词', voice: '语音聊天', start: '开始通话', end: '结束通话', listening: '正在聆听',
  },
  en: {
    book: 'The Last Safe Room', voiceBook: 'Pride and Prejudice', line: 'I ignored the sword and went for her pulse.',
    instruction: 'Let Noor call Dax back before the fire door closes.', say: "It doesn't have to be. You have one respawn left. You're allowed to keep it.",
    rewrite: 'Rewrite', generate: 'Generate version', nav: 'Open chapter navigation', context: 'Open story context', more: 'More options', graph: 'Graph', map: 'Map',
    dialogue: 'My dialogue', voice: 'Voice chat', start: 'Start call', end: 'End call', listening: 'Listening',
  },
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
const openBook = async (page, title) => { await page.getByText(title).first().click(); await page.waitForTimeout(2500) }
const select = (page, text) => page.evaluate((text) => {
  // The demo opens the rewrite panel from a real text selection.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode; const at = node.textContent.indexOf(text)
    if (at < 0) continue
    const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + text.length)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return
  }
}, text)
const scroll = async (page, distance, steps = 12) => {
  await page.mouse.move(195, 500)
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, distance / steps); await page.waitForTimeout(90) }
}
const openRoleplay = async (page, label, title) => {
  await openBook(page, title); await button(page, label.nav).click(); await page.getByText('RP-01').first().click(); await page.waitForTimeout(1500)
}

// Each shot: optional setup off camera, then the recorded part. `rec.fast(n)` plays waiting n× faster.
const shots = {
  reader: {
    record: async (page, label) => { await page.waitForTimeout(900); await openBook(page, label.book); await scroll(page, 450, 12); await page.waitForTimeout(1200) },
  },
  rewrite: {
    setup: (page, label) => openBook(page, label.book),
    record: async (page, label, rec) => {
      await page.waitForTimeout(700); await select(page, label.line); await page.waitForTimeout(900)
      await button(page, label.rewrite).first().click(); await page.waitForTimeout(900)
      const box = page.getByRole('textbox').first()
      await box.click(); await box.fill(''); await box.pressSequentially(label.instruction, { delay: 45 }); await page.waitForTimeout(700)
      await button(page, label.generate).click()
      rec.fast(4); await page.waitForTimeout(6500); rec.fast(1)
      await scroll(page, 500, 10); await page.waitForTimeout(1800)
    },
  },
  branches: {
    setup: (page, label) => openBook(page, label.book),
    record: async (page, label) => {
      await page.waitForTimeout(700); await button(page, label.nav).click(); await page.waitForTimeout(1200)
      await scroll(page, 420, 10); await page.waitForTimeout(1000)
      await page.getByText('IF-01').first().click(); await page.waitForTimeout(1500)
    },
  },
  roleplay: {
    setup: (page, label) => openRoleplay(page, label, label.book),
    record: async (page, label, rec) => {
      await page.waitForTimeout(800)
      const box = page.getByRole('textbox', { name: label.dialogue, exact: true })
      await box.click(); await box.pressSequentially(label.say, { delay: 30 }); await page.waitForTimeout(500)
      await page.getByTestId('roleplay-composer-send').click()
      rec.fast(3); await page.waitForTimeout(3000); rec.fast(1)
      await page.waitForTimeout(2000)
    },
  },
  voice: {
    setup: async (page, label) => { await openRoleplay(page, label, label.voiceBook); await button(page, label.voice).click(); await page.waitForTimeout(800) },
    record: async (page, label) => {
      await page.waitForTimeout(800); await button(page, label.start).click()
      // Two spoken turns. Hanging up mid-clip would drop the unheard reply, so wait to listen again.
      await page.getByTestId('roleplay-message-list').locator('[data-roleplay-block=counterpart]').nth(2).waitFor({ timeout: 60000 })
      await page.getByText(label.listening, { exact: true }).waitFor({ timeout: 30000 })
      await page.waitForTimeout(1200); await button(page, label.end).click(); await page.waitForTimeout(1500)
    },
  },
  graph: {
    setup: (page, label) => openBook(page, label.book),
    record: async (page, label) => {
      await page.waitForTimeout(700); await button(page, label.more).click(); await page.waitForTimeout(600)
      await button(page, label.graph).last().click(); await page.waitForTimeout(2200)
      await button(page, label.map).last().click(); await page.waitForTimeout(2800)
    },
  },
  context: {
    setup: (page, label) => openBook(page, label.book),
    record: async (page, label) => {
      await page.waitForTimeout(700); await button(page, label.context).click(); await page.waitForTimeout(1500)
      await scroll(page, 520, 12); await page.waitForTimeout(1400)
    },
  },
}

// Chrome's screencast sends a frame only when the page changes, so each frame lasts
// until the next one; long static holds are shortened, and `fast` ranges sped up.
async function record(page, run) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  let speed = 1
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp, speed })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688 })
  await run({ fast: (factor) => { speed = factor } })
  await cdp.send('Page.stopScreencast')
  return frames
}

async function encode(frames, file) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'retale-gif-'))
  const list = []
  for (const [index, frame] of frames.entries()) {
    const image = path.join(dir, `${index}.jpg`)
    await fs.writeFile(image, Buffer.from(frame.data, 'base64'))
    const next = frames[index + 1]
    list.push(`file '${image}'`, `duration ${next ? (Math.min(next.time - frame.time, 2) / frame.speed).toFixed(3) : 1}`)
  }
  list.push(list.at(-2)) // The concat demuxer ignores the last duration unless the file repeats.
  await fs.writeFile(path.join(dir, 'list.txt'), list.join('\n'))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', 'fps=10,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', file])
  await fs.rm(dir, { recursive: true })
}

await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  for (const [language, label] of Object.entries(labels)) {
    for (const [name, shot] of Object.entries(shots)) {
      const file = `demo-${name}-${language}.gif`
      if (only.length && !only.includes(`${name}-${language}`)) continue
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      await page.addInitScript(() => localStorage.setItem('retale.demo.tutorial.v1', 'skipped'))
      await page.goto(`${demo}library/`, { waitUntil: 'networkidle' })
      if (language === 'en') await button(page, 'English').click()
      await page.waitForTimeout(800)
      await shot.setup?.(page, label)
      const frames = await record(page, (rec) => shot.record(page, label, rec))
      await encode(frames, path.join(output, file))
      console.log(`${file}  ${frames.length} frames  ${((await fs.stat(path.join(output, file))).size / 1048576).toFixed(1)} MB`)
      await page.close()
    }
  }
} finally { await browser.close() }
