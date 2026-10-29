// Captures the README screenshots from the public demo site (sample books, simulated AI).
// Run from the repository root: node scripts/capture-readme.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const demo = 'https://nitansde.github.io/retale-demo/'
const output = path.resolve('docs/images')
const labels = {
  zh: { book: '退婚当天，我继承了反派宗门', line: '谢无咎从抽屉里翻出一本账', rewrite: '魔改', generate: '生成版本', nav: '打开章节导航', context: '打开故事上下文', more: '更多选项', graph: '图谱', map: '图谱' },
  en: { book: 'The Last Safe Room', line: 'I ignored the sword and went for her pulse.', rewrite: 'Rewrite', generate: 'Generate version', nav: 'Open chapter navigation', context: 'Open story context', more: 'More options', graph: 'Graph', map: 'Map' },
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
const shots = {
  reader: async () => {},
  rewrite: async (page, label) => {
    // The demo opens the rewrite panel from a real text selection.
    await page.evaluate((text) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode; const at = node.textContent.indexOf(text)
        if (at < 0) continue
        const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + text.length)
        getSelection().removeAllRanges(); getSelection().addRange(range)
        node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return
      }
    }, label.line)
    await button(page, label.rewrite).first().click()
    await button(page, label.generate).click()
    await page.waitForTimeout(6000)
  },
  branches: async (page, label) => { await button(page, label.nav).click() },
  roleplay: async (page, label) => { await button(page, label.nav).click(); await page.getByText('RP-01').first().click() },
  graph: async (page, label) => {
    await button(page, label.more).click(); await button(page, label.graph).last().click()
    await page.waitForTimeout(3000); await button(page, label.map).last().click()
  },
  context: async (page, label) => { await button(page, label.context).click() },
}

await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  for (const [language, label] of Object.entries(labels)) {
    for (const [name, open] of Object.entries(shots)) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      await page.goto(demo, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '跳过教程' }).click()
      if (language === 'en') await button(page, 'English').click()
      await page.getByText(label.book).first().click()
      await page.waitForTimeout(2500)
      await open(page, label)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: path.join(output, `demo-${name}-${language}.png`) })
      console.log(`demo-${name}-${language}.png`)
      await page.close()
    }
  }
} finally { await browser.close() }
