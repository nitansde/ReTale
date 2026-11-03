# README 动图 / README GIFs

[简体中文](../README.md) · [English](../README.en.md)

## 素材说明

动图录自公开 [Demo 站](https://ainitan.com)（`https://nitansde.github.io/retale-demo/`）的移动端界面，视口 390 × 844，按 2 倍分辨率录制，输出为 480 px 宽的 GIF，中英文各一套：阅读、魔改、章节分支、角色扮演、语音通话、写作技巧蒸馏、关联图谱和故事上下文。示例书籍为 Demo 站预置的原创短篇和公版名著，AI 结果为 Demo 站预设的模拟内容，语音是用 Fish Audio 预先生成的样例；GIF 没有声音，可在 Demo 站试听。不涉及任何个人书库、设置或密钥。

## About the GIFs

These are recordings of the public [demo site](https://ainitan.com) (`https://nitansde.github.io/retale-demo/`) at a 390 × 844 phone viewport, captured at 2× and saved as 480 px wide GIFs in Chinese and English: reading, rewriting, chapter branches, roleplay, a voice call, writing-skill distillation, the chapter graph, and story context. The books are the demo’s original samples and public-domain classics, the AI results are the demo’s scripted stand-ins, and the voices are samples pre-generated with Fish Audio. GIFs are silent; the demo site plays the audio. No personal library, settings, or keys are involved.

## 重新生成 / Recreate

在项目根目录运行（需要已安装项目依赖、Playwright Chromium 和 [ffmpeg](https://ffmpeg.org/)，并能访问 Demo 站）。可以在命令后加 `voice-zh` 这样的名字只录其中几张，或用 `DEMO_URL` 指向本地运行的 Demo。Run from the repository root, with project dependencies, Playwright Chromium and [ffmpeg](https://ffmpeg.org/) installed and the demo site reachable. Name shots such as `voice-zh` to record only those, or set `DEMO_URL` to a locally running demo:

```bash
npx playwright install chromium
node scripts/capture-readme.mjs
```

输出文件 / Output files: `docs/images/demo-{reader,rewrite,branches,roleplay,voice,skills,graph,context}-{zh,en}.gif`.
