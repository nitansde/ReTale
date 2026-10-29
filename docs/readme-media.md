# README 截图 / README screenshots

[简体中文](../README.md) · [English](../README.en.md)

## 素材说明

截图来自公开 [Demo 站](https://ainitan.com)（`https://nitansde.github.io/retale-demo/`）的移动端界面，视口 390 × 844，输出为 2 倍分辨率 PNG，中英文各一套：阅读、魔改、章节分支、角色扮演、关联图谱和故事上下文。示例书籍为 Demo 站预置的原创短篇，AI 结果为 Demo 站的模拟内容，不涉及任何个人书库、设置或密钥。

## About the screenshots

These are captures of the public [demo site](https://ainitan.com) (`https://nitansde.github.io/retale-demo/`) at a 390 × 844 phone viewport, saved as 2× PNGs in Chinese and English: reading, rewriting, chapter branches, roleplay, the chapter graph, and story context. The books are the demo’s original samples and the AI results are the demo’s simulated output; no personal library, settings, or keys are involved.

## 重新生成 / Recreate

在项目根目录运行（需要已安装项目依赖和 Playwright Chromium，并能访问 Demo 站）。Run from the repository root, with project dependencies and Playwright Chromium installed and the demo site reachable:

```bash
npx playwright install chromium
node scripts/capture-readme.mjs
```

输出文件 / Output files: `docs/images/demo-{reader,rewrite,branches,roleplay,graph,context}-{zh,en}.png`.
