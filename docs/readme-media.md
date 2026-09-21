# README 演示素材 / README demo images

[简体中文](../README.md) · [English](../README.en.md)

## 素材说明

截图来自 ReTale 的实际移动端界面，视口为 390 × 844，输出为 2 倍分辨率 PNG。中英文分别截图，展示阅读、改写要求、章节分支、人物关系与原文依据。

演示故事《雾城来信》及英文版本 *Letters from the Mist* 为本次文档编写的原创示例。小说、分支、知识分析结果和上下文均由截图脚本提供固定数据；未调用 AI 服务生成，未使用用户书库、个人设置或密钥。截图只隐藏 Next.js 开发工具按钮，没有修改产品界面布局。

## About the images

These are screenshots of ReTale’s actual mobile interface at a 390 × 844 viewport, saved as PNGs at twice that resolution. Chinese and English captures show reading, rewrite instructions, chapter branches, and relationship evidence.

*Letters from the Mist* and its Chinese version are original examples written for this documentation. The capture script supplies fixed story, branch, analysis, and context data. It does not call an AI provider or use personal library content, settings, or credentials. Only the Next.js development-tools button is hidden; the product layout is unchanged.

## 重新生成 / Recreate

在项目根目录运行以下命令。需要已安装项目依赖和 Playwright Chromium。截图只访问本机端口 3000，并拦截全部浏览器 API 请求；未准备的请求会使脚本报错。

Run these commands from the repository root, with project dependencies and Playwright Chromium installed. The capture uses localhost port 3000 and intercepts every browser API request; unhandled requests fail the script.

```bash
# Install the screenshot browser if needed.
npx playwright install chromium

# Terminal 1: start the isolated development server on port 3000.
npm run dev:test

# Terminal 2: capture both languages.
node scripts/capture-readme.mjs
```

截图后在第一个终端按 Ctrl+C 停止测试服务器。按项目约定，确保日常服务 `npm run dev:prod` 继续运行于 `0.0.0.0:14500`；已经运行时无需再启动。

After capture, press Ctrl+C in the first terminal to stop the test server. Per project conventions, leave the daily server running via `npm run dev:prod` on `0.0.0.0:14500`; do not start a duplicate if it is already running.

输出文件 / Output files: `docs/images/mobile-{reading,rewrite,branches,evidence}-{zh,en}.png`.
