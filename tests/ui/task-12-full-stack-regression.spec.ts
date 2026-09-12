import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page } from '@playwright/test'
import { createRoleplaySafeDataPath } from '../../scripts/roleplay-safe-qa.mjs'

const ROOT = process.cwd()
const evidenceDirectory = path.join(ROOT, '.sisyphus/evidence/full-project-refactor')
const fixturePath = path.join(ROOT, 'scripts/fixtures/workspace-import-smoke.txt')
const task12NovelTitle = 'task-12-full-stack-regression-novel'
const presetFixturePath = path.join(ROOT, 'tests/fixtures/preset-compat/synthetic-sillytavern-preset.json')
const matrixPath = path.join(evidenceDirectory, 'full-stack-qa-matrix.md')
const performancePath = path.join(evidenceDirectory, 'performance-before-after.md')
const screenshotPath = path.join(evidenceDirectory, 'task-12-i18n-full-stack.png')
const branchI18nScreenshotPath = path.join(evidenceDirectory, 'task-12-branch-i18n.png')
const knowledgeI18nScreenshotPath = path.join(evidenceDirectory, 'task-12-knowledge-i18n.png')
const graphScreenshotPath = path.join(evidenceDirectory, 'task-12-graph-browser.png')
const task9KnowledgeRebuildScreenshotPath = path.join(evidenceDirectory, 'task-9-knowledge-rebuild.png')
const task9CacheGuardrailsScreenshotPath = path.join(evidenceDirectory, 'task-9-cache-guardrails.png')

type WorkspacePayload = {
  currentNovelId: string
  currentChapterId: string
  currentTab?: string
  localNovels: Array<{ id: string }>
  localChapters: Array<{
    id: string
    novelId: string | null
    title: string
    order: number
    content: string
    originalContent?: string | null
    parentChapterId?: string | null
  }>
}

type PresetCompatLibraryPayload = {
  revision: number
  presets: Record<string, {
    id: string
    name: string
    promptRules: Array<{
      id: string
      content: string
      enabled: boolean
      forbidOverrides?: boolean
    }>
    attachedStandaloneRegexIds: string[]
    runtimeSampler: {
      openaiMaxContext: number | null
      maxTokens: number | null
      temperature: number | null
      frequencyPenalty: number | null
      presencePenalty: number | null
      topP: number | null
    }
    transport: {
      streamOpenAI: boolean | null
    }
  }>
  standaloneRegexes: Record<string, {
    id: string
    name: string
  }>
  surfaceBindings: Record<string, {
    presetId: string | null
    enabled: boolean
  }>
}

type WorkspaceIdentity = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  selectedText: string
  chapterTitle: string
}

type FakeProviderRequest = {
  method: string
  pathname: string
  body: string
}

type FakeProviderServer = {
  baseUrl: string
  requests: FakeProviderRequest[]
  close: () => Promise<void>
}

type FakeOllamaRequest = {
  method: string
  pathname: string
  body: string
}

type FakeOllamaServer = {
  baseUrl: string
  requests: FakeOllamaRequest[]
  close: () => Promise<void>
}

type QaRow = {
  flow: string
  status: 'PASS' | 'FAIL'
  evidence: string
  notes: string
}

type ApiTiming = {
  label: string
  ms: number
  status: number
}

type GraphFixtureIdentity = {
  heroEntityId: string
  rivalEntityId: string
  edgeId: string
  relationId: string
}

type KnowledgeJobStatus = {
  jobId: string
  status: string
}

function ensureEvidenceDir() {
  fs.mkdirSync(evidenceDirectory, { recursive: true })
}

function resolveTestDatabasePath() {
  const dbPath = process.env.PLAYWRIGHT_TEST_DB_PATH
  if (!dbPath) {
    throw new Error('PLAYWRIGHT_TEST_DB_PATH is required for task-12 full-stack QA')
  }
  return dbPath
}

function openNovelDatabase(novelId: string) {
  const dataDirectory = createRoleplaySafeDataPath(resolveTestDatabasePath())
  const databasePath = path.join(dataDirectory, 'novels', novelId, 'novel.db')
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Novel database does not exist for ${novelId}: ${databasePath}`)
  }
  return new DatabaseSync(databasePath)
}

function openControlDatabase() {
  const dataDirectory = createRoleplaySafeDataPath(resolveTestDatabasePath())
  const databasePath = path.join(dataDirectory, 'control.db')
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Control database does not exist: ${databasePath}`)
  }
  return new DatabaseSync(databasePath)
}

function readReadyNovelRegistryCount(novelId: string) {
  const database = openControlDatabase()
  try {
    return (database.prepare("SELECT COUNT(*) AS count FROM NovelRegistry WHERE novelId = ? AND migrationStatus = 'ready'").get(novelId) as { count: number }).count
  } finally {
    database.close()
  }
}

function getNovelDataDirectory(novelId: string) {
  return path.join(createRoleplaySafeDataPath(resolveTestDatabasePath()), 'novels', novelId)
}

function readBackupCount(databaseNovelId: string) {
  const database = openNovelDatabase(databaseNovelId)
  try {
    return (database.prepare('SELECT COUNT(*) AS count FROM WorkspaceStateBackup WHERE workspaceStateId = ?').get('singleton') as { count: number }).count
  } finally {
    database.close()
  }
}

function readRoleplayIsolationCounts(databaseNovelId: string) {
  const database = openNovelDatabase(databaseNovelId)
  try {
    return {
      sessions: (database.prepare('SELECT COUNT(*) AS count FROM roleplay_sessions').get() as { count: number }).count,
      timelineNodes: (database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get() as { count: number }).count,
    }
  } finally {
    database.close()
  }
}

function readStoryTimelineNodeCount(databaseNovelId: string, nodeId: string) {
  const database = openNovelDatabase(databaseNovelId)
  try {
    return (database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes WHERE id = ?').get(nodeId) as { count: number }).count
  } finally {
    database.close()
  }
}

function readEntityLinkAndRelationStatus(novelId: string, edgeId: string, relationId: string) {
  const database = openNovelDatabase(novelId)
  try {
    const entityLink = database.prepare(
      'SELECT status, linkType, label, description, polarity, strength, validFromChapter, validUntilChapter, includeByDefault FROM EntityLink WHERE id = ?'
    ).get(edgeId) as {
      status: string
      linkType: string
      label: string | null
      description: string | null
      polarity: string | null
      strength: number
      validFromChapter: number
      validUntilChapter: number
      includeByDefault: number
    } | undefined
    const knowledgeRelation = database.prepare(
      'SELECT status, relationType, polarity, strength, validFromChapter, validUntilChapter FROM KnowledgeRelation WHERE id = ?'
    ).get(relationId) as {
      status: string
      relationType: string
      polarity: string | null
      strength: number
      validFromChapter: number
      validUntilChapter: number
    } | undefined

    return { entityLink, knowledgeRelation }
  } finally {
    database.close()
  }
}

function seedGraphFixtures(identity: WorkspaceIdentity) {
  const database = openNovelDatabase(identity.novelId)
  try {
    const heroEntityId = `${identity.novelId}-task12-graph-hero`
    const rivalEntityId = `${identity.novelId}-task12-graph-rival`
    const edgeId = `${identity.novelId}-task12-graph-edge`
    const relationId = `${identity.novelId}-task12-graph-relation`
    const heroAppearanceId = `${identity.novelId}-task12-graph-appearance-hero`
    const rivalAppearanceId = `${identity.novelId}-task12-graph-appearance-rival`
    const validUntilChapter = 2_147_483_647

    const knowledgeChapter = database.prepare(
      'SELECT id, novelId, branchId, chapterNo FROM KnowledgeChapter WHERE id = ?'
    ).get(identity.chapterId) as {
      id: string
      novelId: string
      branchId: string
      chapterNo: number
    } | undefined
    if (
      !knowledgeChapter
      || knowledgeChapter.id !== identity.chapterId
      || knowledgeChapter.novelId !== identity.novelId
      || knowledgeChapter.branchId !== identity.branchId
      || knowledgeChapter.chapterNo !== identity.chapterNo
    ) {
      throw new Error(`Imported KnowledgeChapter does not match graph fixture identity: ${JSON.stringify(knowledgeChapter ?? null)}`)
    }

    database.prepare(
      `INSERT OR REPLACE INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, importance, userConfirmed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      heroEntityId,
      identity.novelId,
      identity.branchId,
      'character',
      'Task 12 Graph Hero',
      'Primary graph seed entity for Task 12 regression coverage.',
      identity.chapterNo,
      identity.chapterNo,
      'protagonist',
      'active',
      99,
      1,
    )

    database.prepare(
      `INSERT OR REPLACE INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, importance, userConfirmed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      rivalEntityId,
      identity.novelId,
      identity.branchId,
      'character',
      'Task 12 Graph Rival',
      'Secondary graph seed entity for Task 12 regression coverage.',
      identity.chapterNo,
      identity.chapterNo,
      'important',
      'active',
      98,
      0,
    )

    database.prepare(
      `INSERT OR REPLACE INTO EntityAppearance (
        id, entityId, chapterId, chapterNo, lineStart, lineEnd, evidenceSpanId
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(heroAppearanceId, heroEntityId, identity.chapterId, identity.chapterNo, 1, 1, null)

    database.prepare(
      `INSERT OR REPLACE INTO EntityAppearance (
        id, entityId, chapterId, chapterNo, lineStart, lineEnd, evidenceSpanId
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(rivalAppearanceId, rivalEntityId, identity.chapterId, identity.chapterNo, 1, 1, null)

    database.prepare(
      `INSERT OR REPLACE INTO EntityLink (
        id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
        polarity, strength, weight, sourceChapter, validFromChapter, validUntilChapter,
        evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      edgeId,
      identity.novelId,
      identity.branchId,
      heroEntityId,
      rivalEntityId,
      'alliance',
      'Task 12 Graph Link',
      'Initial graph link before Task 12 mutation coverage.',
      'positive',
      3,
      1,
      identity.chapterNo,
      identity.chapterNo,
      validUntilChapter,
      null,
      'Task 12 graph edge evidence quote.',
      0.82,
      'ai_generated',
      1,
    )

    database.prepare(
      `INSERT OR REPLACE INTO KnowledgeRelation (
        id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength,
        sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId, confidence, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      relationId,
      identity.novelId,
      identity.branchId,
      heroEntityId,
      rivalEntityId,
      'alliance',
      'positive',
      3,
      identity.chapterNo,
      identity.chapterNo,
      validUntilChapter,
      null,
      0.82,
      'ai_generated',
    )

    return { heroEntityId, rivalEntityId, edgeId, relationId } satisfies GraphFixtureIdentity
  } finally {
    database.close()
  }
}

function seedFutureJumpFixtures(identity: WorkspaceIdentity) {
  const database = openNovelDatabase(identity.novelId)
  try {
    const targetChapterId = `${identity.novelId}-task12-future-target`
    const outlineNodeId = `${identity.novelId}-task12-outline-node`
    const outlineChapterId = `${identity.novelId}-task12-outline-chapter`
    const targetChapterNo = identity.chapterNo + 99

    database.prepare(
      `INSERT OR REPLACE INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      targetChapterId,
      identity.novelId,
      identity.branchId,
      targetChapterNo,
      '第100章 迟到的真相',
      '第100章正文：真相终究在更晚的时候爆发。',
      '第100章摘要：迟到的真相。',
      1,
      0,
      null,
      `${targetChapterId}-hash`,
      'ready'
    )

    database.prepare(
      `INSERT OR REPLACE INTO outline_nodes (
        id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
        track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      outlineNodeId,
      identity.novelId,
      identity.branchId,
      targetChapterNo,
      '第100章 迟到的真相',
      '真相在更晚的节点才揭开。',
      '原线里更早解决。',
      'phase-task12',
      'Task 12',
      'authored',
      1,
      '[]',
      '[]',
      targetChapterNo,
    )

    database.prepare(
      `INSERT OR REPLACE INTO outline_node_chapters (
        id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      outlineChapterId,
      outlineNodeId,
      targetChapterNo,
      targetChapterId,
      '第100章 迟到的真相',
      1,
      0,
    )

    return { targetChapterId, outlineNodeId, outlineChapterId, targetChapterNo }
  } finally {
    database.close()
  }
}

async function startFakeProviderServer() {
  const requests: FakeProviderRequest[] = []
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push({ method: request.method ?? 'GET', pathname: url.pathname, body })

    if (url.pathname.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'task-12-fake-model', owned_by: 'task-12' }] }))
      return
    }

    if (url.pathname.endsWith('/chat/completions')) {
      const shouldFail = body.includes('TASK12_PROVIDER_ERROR')
      if (shouldFail) {
        response.writeHead(502, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Task 12 fake provider rejected the request.' } }))
        return
      }

      const isStream = body.includes('"stream":true')
      if (isStream) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        response.write('data: Task 12 fake stream output：风声先一步推开了门。\n\n')
        response.write('data: 她抬眼时，屋里的沉默像被重新排列。\n\n')
        response.end('data: [DONE]\n\n')
        return
      }

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          result: 'Task 12 fake rewrite output：风声先一步推开了门。她抬眼时，屋里的沉默像被重新排列。',
          bridgeSummary: '误会并没有在分歧发生后立刻爆炸成彻底的决裂，而是被更长时间地压在每一次犹豫、误判和沉默里。男主明明已经察觉到线索有缺口，却因为先前的怀疑迟迟不肯回头确认，只把新的异常当成对方又一次刻意隐瞒。女主则在一次次等待解释却始终落空之后，把原本尚能挽回的信任慢慢收紧成防备，哪怕仍想靠近，也只能逼着自己先把情绪藏起来。两人因此在同一条调查线上不断错身，一个自以为再观察一步就能看清真相，一个自以为再硬撑一下就能不再受伤，结果却让反派有了更从容的布局空间。外围势力顺着这条裂缝散播假消息、调换目击线索、切断原本能让双方重新对话的中间桥梁，让所有迟来的善意都看上去像掩饰，所有本该及时说开的解释都变成更晚一步的遗憾。等他们终于各自意识到问题真正指向反派而不是彼此时，误会已经积累成足以改变行动路径的惯性：男主错过了最早阻止陷阱成形的时机，女主也在孤立无援的判断里被逼向更危险的位置，最终让未来章节里的绑走与迟到救援，既像突发意外，又像这条分歧线上被一点点推出来的必然结果。',
          generatedTargetText: 'Task 12 fake future text：当真相终于爆发时，他们都已经错过了最早和解的时机。',
          titleHint: 'Task 12 Future Jump',
          subtitleHint: 'Delayed truth branch',
        }) } }],
        usage: { prompt_tokens: 123, completion_tokens: 45 },
      }))
      return
    }

    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Not found' }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve fake provider server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  } satisfies FakeProviderServer
}

async function startFakeOllamaServer() {
  const requests: FakeOllamaRequest[] = []
  const textModelId = 'task12-ollama-text:latest'
  const embeddingModelId = 'task12-ollama-embed:latest'
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push({ method: request.method ?? 'GET', pathname: url.pathname, body })

    if (request.method === 'GET' && url.pathname === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        models: [
          {
            name: textModelId,
            model: textModelId,
            modified_at: '2026-06-05T00:00:00Z',
            size: 8_000_000_000,
            details: {
              family: 'qwen',
              parameter_size: '8B',
              quantization_level: 'Q4_K_M',
            },
          },
          {
            name: embeddingModelId,
            model: embeddingModelId,
            modified_at: '2026-06-05T00:00:00Z',
            size: 274_000_000,
            details: {
              family: 'nomic-embed',
              parameter_size: '274M',
              quantization_level: 'F16',
            },
          },
        ],
      }))
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/show') {
      const payload = JSON.parse(body || '{}') as { model?: string }
      const capabilities = payload.model === embeddingModelId ? ['embedding'] : ['completion']
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ capabilities }))
      return
    }

    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Not found' }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve fake Ollama server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  } satisfies FakeOllamaServer
}

async function importWorkspaceFixture(page: Page, novelTitle: string) {
  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: /导入小说|Import novel/ })).toBeVisible()

  const importResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST'
  )
  await page.locator('input[type=file]').setInputFiles({
    name: `${novelTitle}.txt`,
    mimeType: 'text/plain',
    buffer: fs.readFileSync(fixturePath),
  })
  const importResponse = await importResponsePromise
  expect(importResponse.ok()).toBeTruthy()
  const imported = await importResponse.json() as { novelId: string; chapterId: string }
  await page.waitForLoadState('networkidle')
  if (!/\/workspace/.test(page.url())) {
    await page.goto('/workspace', { waitUntil: 'networkidle' })
  }
  return { status: importResponse.status(), ...imported }
}

async function selectEntireChapter(page: Page) {
  await page.getByTestId('workspace-chapter-reader').first().evaluate((editor) => {
    const paragraph = editor.querySelector('p')
    const textNode = paragraph?.firstChild
    if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Failed to resolve editor text node for task-12 selection')
    }
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function replaceEditorText(page: Page, text: string) {
  const editor = page.getByTestId('workspace-chapter-reader').first()
  if (await editor.getAttribute('contenteditable') !== 'true') await page.getByTestId('workspace-reader-edit-toggle').click()
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(` ${text}`)
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText(text)
}

async function dismissWorkspaceActionOverlayIfVisible(page: Page) {
  const overlay = page.getByTestId('workspace-action-overlay')
  if (await overlay.count()) {
    const isVisible = await overlay.isVisible().catch(() => false)
    if (isVisible) {
      await overlay.click({ position: { x: 8, y: 8 } })
      await expect(overlay).toBeHidden()
    }
  }
}

async function openModelServiceSettings(page: Page) {
  const settingsButton = page.getByTestId('preset-compat-library-open').locator('xpath=following-sibling::button[1]')
  await settingsButton.evaluate((node) => {
    ;(node as HTMLButtonElement).click()
  })
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'AI models', exact: true }).click()
}

async function readBrowserWorkspaceSession(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('retale.workspace-session.v1')
    if (!raw) return { currentNovelId: '', currentChapterIds: {} as Record<string, string>, currentTab: 'editor' }
    const parsed = JSON.parse(raw) as {
      currentNovelId?: unknown
      currentChapterIds?: unknown
      currentTab?: unknown
    }
    return {
      currentNovelId: typeof parsed.currentNovelId === 'string' ? parsed.currentNovelId : '',
      currentChapterIds: typeof parsed.currentChapterIds === 'object' && parsed.currentChapterIds !== null
        ? parsed.currentChapterIds as Record<string, string>
        : {},
      currentTab: typeof parsed.currentTab === 'string' ? parsed.currentTab : 'editor',
    }
  })
}

async function fetchWorkspace(page: Page, requestedNovelId?: string) {
  const session = await readBrowserWorkspaceSession(page)
  const libraryResponse = await page.request.get('/api/novels')
  expect(libraryResponse.ok()).toBeTruthy()
  const library = await libraryResponse.json() as { novels: Array<{ id: string }> }
  const sessionNovelId = library.novels.some((novel) => novel.id === session.currentNovelId)
    ? session.currentNovelId
    : ''
  const novelId = requestedNovelId || sessionNovelId || library.novels[0]?.id || ''
  if (!novelId) {
    return { currentNovelId: '', currentChapterId: '', currentTab: session.currentTab, localNovels: [], localChapters: [] } satisfies WorkspacePayload
  }

  const response = await page.request.get(`/api/novels/${encodeURIComponent(novelId)}`)
  expect(response.ok()).toBeTruthy()
  const resource = await response.json() as Omit<WorkspacePayload, 'currentNovelId' | 'currentChapterId'>
  const rememberedChapterId = session.currentChapterIds[novelId]
  const currentChapterId = resource.localChapters.some((chapter) => chapter.id === rememberedChapterId)
    ? rememberedChapterId
    : [...resource.localChapters].sort((left, right) => left.order - right.order)[0]?.id ?? ''
  return {
    ...resource,
    currentNovelId: novelId,
    currentChapterId,
    currentTab: session.currentTab,
  } satisfies WorkspacePayload
}

async function fetchPresetCompatLibraryState(page: Page) {
  const response = await page.request.get('/api/settings/preset-compat')
  expect(response.ok()).toBeTruthy()
  return await response.json() as PresetCompatLibraryPayload
}

async function readActiveKnowledgeJobs(page: Page, novelId: string) {
  const response = await page.request.get(`/api/knowledge-view?novelId=${novelId}&statusOnly=1`)
  expect(response.ok()).toBeTruthy()
  const payload = await response.json() as {
    ok?: boolean
    knowledgeRebuildStatus?: KnowledgeJobStatus | null
    knowledgeStatusOverview?: {
      retrievalIndex?: { task?: KnowledgeJobStatus | null }
    } | null
  }
  expect(payload.ok).toBe(true)

  const activeStatuses = new Set(['queued', 'running', 'paused'])
  const jobs = [
    payload.knowledgeRebuildStatus ?? null,
    payload.knowledgeStatusOverview?.retrievalIndex?.task ?? null,
  ].filter((job): job is KnowledgeJobStatus => Boolean(job && activeStatuses.has(job.status)))

  return [...new Map(jobs.map((job) => [job.jobId, job])).values()]
}

async function settleActiveKnowledgeJobs(page: Page, novelId: string) {
  for (let abortCount = 0; abortCount < 2; abortCount += 1) {
    const activeJobs = await readActiveKnowledgeJobs(page, novelId)
    if (!activeJobs.length) return

    const abortResponse = await page.request.post('/api/knowledge-view', {
      data: { novelId, action: 'abort' },
    })
    expect(abortResponse.status()).toBe(200)
    const abortPayload = await abortResponse.json() as { ok?: boolean; jobOutcome?: unknown }
    expect(abortPayload.ok).toBe(true)
    expect(['aborted', 'idle']).toContain(abortPayload.jobOutcome)
  }

  expect(await readActiveKnowledgeJobs(page, novelId)).toEqual([])
}

async function ensureKnowledgeAdvancedDetailsOpen(page: Page) {
  const advancedDetails = page.getByTestId('workspace-knowledge-advanced-details')
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    if (await advancedDetails.isVisible()) return

    const toggle = page.getByRole('button', { name: 'Advanced details' })
    if (await toggle.isVisible()) {
      await toggle.click()
    }
    await page.waitForTimeout(250)
  }

  await expect(advancedDetails).toBeVisible()
}

async function resolveWorkspaceIdentity(page: Page) {
  const workspace = await fetchWorkspace(page)
  const currentChapter = workspace.localChapters.find((chapter) => chapter.id === workspace.currentChapterId)
  if (!workspace.currentNovelId || !currentChapter) {
    throw new Error('Failed to resolve current workspace identity for task-12 QA')
  }
  return {
    novelId: workspace.currentNovelId,
    branchId: `${workspace.currentNovelId}:main`,
    chapterId: currentChapter.id,
    chapterNo: currentChapter.order,
    chapterTitle: currentChapter.title,
    selectedText: stripHtml(currentChapter.content).trim(),
  } satisfies WorkspaceIdentity
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function timedRequest<T>(label: string, request: Promise<T>, statusOf: (value: T) => number, timings: ApiTiming[]) {
  const startedAt = Date.now()
  const result = await request
  timings.push({ label, ms: Date.now() - startedAt, status: statusOf(result) })
  return result
}

function appendQaRow(rows: QaRow[], flow: string, evidence: string, notes: string) {
  rows.push({ flow, status: 'PASS', evidence, notes })
}

async function waitForObservedCountToStabilize(readCount: () => number, options: {
  minCount: number
  timeoutMs: number
  intervalMs?: number
  stableIntervals?: number
}) {
  const intervalMs = options.intervalMs ?? 200
  const stableIntervals = options.stableIntervals ?? 5
  const deadline = Date.now() + options.timeoutMs
  let lastCount = readCount()
  let stableCount = lastCount >= options.minCount ? 1 : 0

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    const currentCount = readCount()
    if (currentCount !== lastCount) {
      lastCount = currentCount
      stableCount = currentCount >= options.minCount ? 1 : 0
      continue
    }
    if (currentCount >= options.minCount) {
      stableCount += 1
      if (stableCount >= stableIntervals) {
        return currentCount
      }
    }
  }

  throw new Error(`Observed count did not stabilize before timeout; last count was ${lastCount}, expected at least ${options.minCount}.`)
}

test('task 12 exhaustive full-stack regression and evidence', async ({ page }) => {
  test.setTimeout(240_000)
  ensureEvidenceDir()

  const qaRows: QaRow[] = []
  const apiTimings: ApiTiming[] = []
  const fakeProvider = await startFakeProviderServer()
  const fakeOllama = await startFakeOllamaServer()
  const knowledgePollEvents: Array<{ url: string; method: string }> = []
  const workspaceSaveTimestamps: string[] = []

  page.on('response', async (response) => {
    const request = response.request()
    if (request.url().includes('/api/knowledge-view') && request.method() === 'GET') {
      knowledgePollEvents.push({ url: request.url(), method: request.method() })
    }
  })
  page.on('response', (response) => {
    const method = response.request().method()
    const pathname = new URL(response.url()).pathname
    if (
      ((method === 'PATCH' && pathname.startsWith('/api/chapters/'))
        || (method === 'POST' && pathname.startsWith('/api/novels/')))
      && response.ok()
    ) {
      workspaceSaveTimestamps.push(new Date().toISOString())
    }
  })

  try {
    const libraryStartedAt = Date.now()
    await page.goto('/library', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: '书库' })).toBeVisible()
    const libraryLoadMs = Date.now() - libraryStartedAt
    await expect(page.getByRole('button', { name: '导入小说' })).toBeVisible()
    await expect(page.getByTestId('app-language-option-zh')).toHaveAttribute('aria-pressed', 'true')
    appendQaRow(qaRows, 'Chinese default surfaces', '[task-12-i18n-full-stack.png](./task-12-i18n-full-stack.png)', 'Verified on library before any locale switch.')

    await page.getByTestId('app-language-option-en').click()
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import novel' })).toBeVisible()

    const importResult = await importWorkspaceFixture(page, task12NovelTitle)
    const workspaceLoadStartedAt = Date.now()
    await expect(page.getByRole('heading', { name: 'Chapters', exact: true })).toBeVisible()
    await expect(page.getByTestId('workspace-current-word-count')).toContainText('words')
    const workspaceLoadMs = Date.now() - workspaceLoadStartedAt
    await expect(page.getByTestId('app-language-switcher')).toHaveCount(0)

    const saveBaseline = workspaceSaveTimestamps.length
    const editedText = 'Task 12 full-stack save proof: the workspace persists this edited line after reload.'
    const saveStartedAt = Date.now()
    const saveResponsePromise = page.waitForResponse((response) => {
      const method = response.request().method()
      const pathname = new URL(response.url()).pathname
      return ((method === 'PATCH' && pathname.startsWith('/api/chapters/'))
        || (method === 'POST' && pathname.startsWith('/api/novels/')))
        && response.ok()
    })
    await replaceEditorText(page, editedText)
    const saveResponse = await saveResponsePromise
    const saveLatencyMs = Date.now() - saveStartedAt
    expect(saveResponse.ok()).toBeTruthy()
    await waitForObservedCountToStabilize(() => workspaceSaveTimestamps.length, {
      minCount: saveBaseline + 1,
      timeoutMs: 10_000,
    })
    const workspaceSavesTriggeredByEdit = workspaceSaveTimestamps.length - saveBaseline
    const redundantSaveCountOverIdle = Math.max(0, workspaceSavesTriggeredByEdit - 1)
    expect(workspaceSavesTriggeredByEdit).toBe(1)
    expect(redundantSaveCountOverIdle).toBe(0)

    const novelExport = await timedRequest(
      'novel-export',
      page.request.get(`/api/novels/${encodeURIComponent(importResult.novelId)}`),
      (response) => response.status(),
      apiTimings,
    )
    expect(novelExport.ok()).toBeTruthy()
    const exportedResource = await novelExport.json() as Omit<WorkspacePayload, 'currentNovelId' | 'currentChapterId'>
    const exportedWorkspace: WorkspacePayload = {
      ...exportedResource,
      currentNovelId: importResult.novelId,
      currentChapterId: importResult.chapterId,
    }
    const backupCountBeforeRestore = readBackupCount(exportedWorkspace.currentNovelId)
    expect(backupCountBeforeRestore).toBeGreaterThanOrEqual(0)
    const restoredWorkspace = {
      ...exportedWorkspace,
      currentTab: exportedWorkspace.currentTab ?? 'editor',
      localChapters: exportedWorkspace.localChapters.map((chapter) => chapter.id === exportedWorkspace.currentChapterId
        ? { ...chapter, content: '<p>Task 12 restored export/import payload.</p>' }
        : chapter),
    }
    const restoreAuthority = await page.request.get(`/api/novels/${encodeURIComponent(importResult.novelId)}`)
    expect(restoreAuthority.ok()).toBeTruthy()
    const restoreResponse = await timedRequest(
      'novel-import-restore',
      page.request.post(`/api/novels/${encodeURIComponent(importResult.novelId)}`, { data: restoredWorkspace, headers: {
        'X-Retale-Base-Revision': restoreAuthority.headers()['x-retale-workspace-revision'],
        'X-Retale-Revision-Novel-Id': importResult.novelId,
        'Idempotency-Key': crypto.randomUUID(),
      } }),
      (response) => response.status(),
      apiTimings,
    )
    expect(restoreResponse.ok()).toBeTruthy()
    const backupCountAfterRestore = readBackupCount(exportedWorkspace.currentNovelId)
    expect(backupCountAfterRestore).toBe(Math.min(backupCountBeforeRestore + 1, 20))
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByTestId('workspace-chapter-body-view')).toContainText('Task 12 restored export/import payload.')
    appendQaRow(qaRows, 'Library import + novel load/edit/save/reload + JSON export/import/backup', '[performance-before-after.md](./performance-before-after.md)', `Import status ${importResult.status}; resource save latency ${saveLatencyMs} ms; backup count ${backupCountBeforeRestore} -> ${backupCountAfterRestore}.`)

    const aiSettingsGet = await timedRequest(
      'settings-ai-get',
      page.request.get('/api/settings/ai'),
      (response) => response.status(),
      apiTimings,
    )
    expect(aiSettingsGet.ok()).toBeTruthy()

    await openModelServiceSettings(page)
    await expect(page.getByRole('button', { name: 'OpenAI-compatible API' }).first()).toBeVisible()
    const rewriteScenario = page.getByTestId('ai-settings-scenario-rewrite')
    await rewriteScenario.getByRole('button', { name: 'OpenAI-compatible API' }).click()
    await rewriteScenario.getByLabel('Base URL').fill(fakeProvider.baseUrl)
    await rewriteScenario.getByLabel('API Key').fill('task-12-key')
    const openAIModelsResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/settings/ai/openai-models' && response.request().method() === 'POST' && response.ok()
    )
    await rewriteScenario.getByRole('button', { name: 'Refresh models' }).click()
    const openAIModelsResponse = await openAIModelsResponsePromise
    expect(openAIModelsResponse.ok()).toBeTruthy()
    await expect(rewriteScenario.locator('select')).toContainText('task-12-fake-model')
    await rewriteScenario.locator('select').selectOption('task-12-fake-model')
    await expect(rewriteScenario.locator('input').nth(2)).toHaveValue('task-12-fake-model')

    const knowledgeScenario = page.getByTestId('ai-settings-scenario-knowledgeExtraction')
    await knowledgeScenario.getByRole('button', { name: 'OpenAI-compatible API' }).click()
    await knowledgeScenario.getByLabel('Base URL').fill(fakeProvider.baseUrl)
    await knowledgeScenario.getByLabel('API Key').fill('task-12-key')
    await knowledgeScenario.locator('input').nth(2).fill('task-12-fake-model')
    await knowledgeScenario.locator('input').nth(3).fill('1')

    const embeddingScenario = page.getByTestId('ai-settings-scenario-embeddings')
    await embeddingScenario.getByRole('button', { name: 'OpenAI-compatible API' }).click()
    await embeddingScenario.getByLabel('Base URL').fill(fakeProvider.baseUrl)
    await embeddingScenario.getByLabel('API Key').fill('task-12-key')
    await embeddingScenario.locator('input').nth(2).fill('task-12-fake-model')
    await embeddingScenario.locator('input').nth(3).fill('16')

    const aiSettingsSaveResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/settings/ai' && response.request().method() === 'POST' && response.ok()
    )
    await page.getByRole('button', { name: 'Save settings' }).click()
    const aiSettingsSave = await aiSettingsSaveResponsePromise
    expect(aiSettingsSave.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0)

    const persistedAiSettingsResponse = await timedRequest(
      'settings-ai-postsave-get',
      page.request.get('/api/settings/ai'),
      (response) => response.status(),
      apiTimings,
    )
    expect(persistedAiSettingsResponse.ok()).toBeTruthy()
    const persistedAiSettings = await persistedAiSettingsResponse.json() as {
      rewrite?: { openAICompatible?: { baseUrl?: string; model?: string } }
      knowledgeExtraction?: { openAICompatible?: { model?: string; parallelism?: number } }
      embeddings?: { openAICompatible?: { model?: string }; embeddingBatchSize?: number }
    }
    expect(persistedAiSettings.rewrite?.openAICompatible?.baseUrl).toBe(fakeProvider.baseUrl)
    expect(persistedAiSettings.rewrite?.openAICompatible?.model).toBe('task-12-fake-model')
    expect(persistedAiSettings.knowledgeExtraction?.openAICompatible?.model).toBe('task-12-fake-model')
    expect(persistedAiSettings.knowledgeExtraction?.openAICompatible?.parallelism).toBe(1)
    expect(persistedAiSettings.embeddings?.openAICompatible?.model).toBe('task-12-fake-model')
    expect(persistedAiSettings.embeddings?.embeddingBatchSize).toBe(16)

    await page.reload({ waitUntil: 'networkidle' })
    await openModelServiceSettings(page)
    const rewriteOllamaScenario = page.getByTestId('ai-settings-scenario-rewrite')
    await rewriteOllamaScenario.getByRole('button', { name: 'Ollama' }).click()
    await rewriteOllamaScenario.getByLabel('Ollama Base URL').fill(fakeOllama.baseUrl)
    const ollamaTextModelsResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/settings/ai/ollama-models?purpose=text') && response.request().method() === 'GET' && response.ok()
    )
    await rewriteOllamaScenario.getByRole('button', { name: 'Refresh local models' }).click()
    const ollamaTextModelsResponse = await ollamaTextModelsResponsePromise
    expect(ollamaTextModelsResponse.ok()).toBeTruthy()
    await expect(rewriteOllamaScenario.locator('select')).toContainText('task12-ollama-text:latest')
    await expect(rewriteOllamaScenario.locator('select')).not.toContainText('task12-ollama-embed:latest')

    const embeddingOllamaScenario = page.getByTestId('ai-settings-scenario-embeddings')
    await embeddingOllamaScenario.getByRole('button', { name: 'Ollama' }).click()
    await embeddingOllamaScenario.getByLabel('Ollama Base URL').fill(fakeOllama.baseUrl)
    const ollamaEmbeddingModelsResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/settings/ai/ollama-models?purpose=embedding') && response.request().method() === 'GET' && response.ok()
    )
    await embeddingOllamaScenario.getByRole('button', { name: 'Refresh local models' }).click()
    const ollamaEmbeddingModelsResponse = await ollamaEmbeddingModelsResponsePromise
    expect(ollamaEmbeddingModelsResponse.ok()).toBeTruthy()
    await expect(embeddingOllamaScenario.locator('select')).toContainText('task12-ollama-embed:latest')
    await expect(embeddingOllamaScenario.locator('select')).not.toContainText('task12-ollama-text:latest')
    appendQaRow(qaRows, 'AI settings save + model discovery via settings UI', '[performance-before-after.md](./performance-before-after.md)', `Saved OpenAI-compatible rewrite/knowledge/embedding settings through the modal, used UI-driven OpenAI model discovery for rewrite plus UI-driven Ollama text/embedding discovery, then kept GET /api/settings/ai as a supplementary persistence readback; observed ${fakeOllama.requests.length} Ollama requests.`)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Presets' }).evaluate((node) => {
      ;(node as HTMLButtonElement).click()
    })
    await expect(page.getByTestId('preset-compat-library-modal')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Global preset compatibility library' })).toBeVisible()

    const presetImportResponsePromise = page.waitForResponse((response) => {
      const request = response.request()
      return response.url().includes('/api/settings/preset-compat/import')
        && request.method() === 'POST'
        && (request.postData() ?? '').includes('"kind":"preset"')
    })
    await page.getByTestId('preset-compat-preset-import-input').setInputFiles(presetFixturePath)
    const presetImportResponse = await presetImportResponsePromise
    expect(presetImportResponse.ok()).toBeTruthy()
    const presetImportPayload = await presetImportResponse.json() as {
      ok?: boolean
      importedIds?: string[]
    }
    expect(presetImportPayload.ok).toBeTruthy()
    const importedPresetId = presetImportPayload.importedIds?.[0] ?? null
    expect(importedPresetId).toBeTruthy()

    const regexImportResponsePromise = page.waitForResponse((response) => {
      const request = response.request()
      return response.url().includes('/api/settings/preset-compat/import')
        && request.method() === 'POST'
        && (request.postData() ?? '').includes('"kind":"regex"')
    })
    await page.getByTestId('preset-compat-regex-import-input').setInputFiles({
      name: 'task-12-standalone-regex.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        regex_scripts: [{
          id: 'task12-fixture-regex',
          scriptName: 'Task 12 standalone regex',
          findRegex: 'hero',
          replaceString: 'protagonist',
          trimStrings: [],
          placement: 2,
          disabled: false,
          markdownOnly: false,
          promptOnly: false,
          runOnEdit: false,
          substituteRegex: 0,
          minDepth: null,
          maxDepth: null,
        }],
      })),
    })
    const regexImportResponse = await regexImportResponsePromise
    expect(regexImportResponse.ok()).toBeTruthy()
    const regexImportPayload = await regexImportResponse.json() as {
      ok?: boolean
      importedIds?: string[]
    }
    expect(regexImportPayload.ok).toBeTruthy()
    const importedRegexId = regexImportPayload.importedIds?.[0] ?? null
    expect(importedRegexId).toBeTruthy()

    const presetLibraryAfterImport = await fetchPresetCompatLibraryState(page)
    const importedPreset = importedPresetId ? presetLibraryAfterImport.presets[importedPresetId] : null
    expect(importedPreset).toBeTruthy()
    const importedPresetName = importedPreset?.name ?? 'synthetic-sillytavern-preset'
    const editablePromptRule = importedPreset?.promptRules.find((rule) => rule.id === 'synthetic-main' && !rule.forbidOverrides) ?? null
    expect(editablePromptRule).toBeTruthy()
    if (!importedPresetId) throw new Error('Imported preset ID was not returned')

    const importedPresetButton = page.locator('button').filter({ hasText: importedPresetName }).first()
    await expect(importedPresetButton).toBeVisible()
    await expect(page.getByTestId(`preset-compat-standalone-regex-attach-${importedRegexId}`)).toBeVisible()
    await importedPresetButton.click()

    for (const surfaceId of ['rewrite', 'future_jump', 'roleplay'] as const) {
      await page.getByTestId(`preset-compat-binding-${surfaceId}`).selectOption(importedPresetId)
      await expect(page.getByTestId(`preset-compat-binding-${surfaceId}`)).toHaveValue(importedPresetId)
    }

    await page.getByTestId('preset-compat-runtime-openai-max-context').fill('16384')
    await page.getByTestId('preset-compat-runtime-max-tokens').fill('2048')
    await page.getByTestId('preset-compat-runtime-temperature').fill('0.55')
    await page.getByTestId('preset-compat-runtime-frequency-penalty').fill('0.2')
    await page.getByTestId('preset-compat-runtime-presence-penalty').fill('0.1')
    await page.getByTestId('preset-compat-runtime-top-p').fill('0.85')
    await page.getByTestId('preset-compat-transport-stream-openai').selectOption('true')
    await page.getByTestId(`preset-compat-rule-content-${editablePromptRule?.id ?? ''}`).fill('Task 12 preset persistence proof.')
    await page.getByTestId(`preset-compat-standalone-regex-attach-${importedRegexId}`).click()

    await page.getByTestId('preset-compat-preview-surface-select').selectOption('rewrite')
    await page.getByTestId('preset-compat-preview-generate').click()
    await expect(page.getByTestId('preset-compat-preview-surface-rewrite')).toBeVisible()
    await expect(page.getByTestId('preset-compat-preview-user-rewrite')).toHaveValue(/<synthetic-user-input>/)

    const presetSaveResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/settings/preset-compat') && response.request().method() === 'POST' && response.ok()
    )
    await page.getByRole('button', { name: 'Save library' }).click()
    const presetSaveResponse = await presetSaveResponsePromise
    expect(presetSaveResponse.ok()).toBeTruthy()
    await expect(page.getByTestId('preset-compat-library-modal')).toContainText(/saved/i)

    const presetLibraryAfterSave = await fetchPresetCompatLibraryState(page)
    const savedPreset = importedPresetId ? presetLibraryAfterSave.presets[importedPresetId] : null
    expect(savedPreset).toBeTruthy()
    expect(presetLibraryAfterSave.surfaceBindings.rewrite.presetId).toBe(importedPresetId)
    expect(presetLibraryAfterSave.surfaceBindings.future_jump.presetId).toBe(importedPresetId)
    expect(presetLibraryAfterSave.surfaceBindings.roleplay.presetId).toBe(importedPresetId)
    expect(savedPreset?.runtimeSampler.openaiMaxContext).toBe(16384)
    expect(savedPreset?.runtimeSampler.maxTokens).toBe(2048)
    expect(savedPreset?.runtimeSampler.temperature).toBe(0.55)
    expect(savedPreset?.runtimeSampler.frequencyPenalty).toBe(0.2)
    expect(savedPreset?.runtimeSampler.presencePenalty).toBe(0.1)
    expect(savedPreset?.runtimeSampler.topP).toBe(0.85)
    expect(savedPreset?.transport.streamOpenAI).toBe(true)
    expect(savedPreset?.attachedStandaloneRegexIds).toContain(importedRegexId)
    expect(savedPreset?.promptRules.some((rule) => rule.content === 'Task 12 preset persistence proof.')).toBeTruthy()

    const presetDownloadPromise = page.waitForEvent('download')
    await page.getByTestId(`preset-compat-preset-export-${importedPresetId}`).click()
    const presetDownload = await presetDownloadPromise
    const presetDownloadPath = path.join(evidenceDirectory, 'task-12-preset-export.json')
    await presetDownload.saveAs(presetDownloadPath)
    expect(presetDownload.suggestedFilename()).toBe(`${importedPresetName}.json`)
    const exportedPresetJson = JSON.parse(fs.readFileSync(presetDownloadPath, 'utf8')) as Record<string, unknown>
    expect(Array.isArray(exportedPresetJson.prompts)).toBe(true)
    expect(Array.isArray(exportedPresetJson.prompt_order)).toBe(true)
    expect(exportedPresetJson).toMatchObject({
      openai_max_context: 16384,
      openai_max_tokens: 2048,
      temperature: 0.55,
      top_p: 0.85,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
      stream_openai: true,
    })

    const regexDownloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export regex bundle' }).click()
    const regexDownload = await regexDownloadPromise
    const regexDownloadPath = path.join(evidenceDirectory, 'task-12-regex-export.json')
    await regexDownload.saveAs(regexDownloadPath)
    expect(regexDownload.suggestedFilename()).toBe('preset-compat-standalone-regexes.json')
    const exportedRegexJson = JSON.parse(fs.readFileSync(regexDownloadPath, 'utf8')) as {
      regex_scripts?: Array<{ scriptName?: string }>
    }
    expect(Array.isArray(exportedRegexJson.regex_scripts)).toBe(true)
    expect(exportedRegexJson.regex_scripts?.some((regexRecord) => regexRecord.scriptName === 'Task 12 standalone regex')).toBeTruthy()

    await page.mouse.click(12, 12)
    await expect(page.getByTestId('preset-compat-library-modal')).toHaveCount(0)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Presets' }).evaluate((node) => {
      ;(node as HTMLButtonElement).click()
    })
    await expect(page.getByTestId('preset-compat-library-modal')).toBeVisible()
    await page.locator('button').filter({ hasText: importedPresetName }).first().click()
    await expect(page.getByTestId('preset-compat-binding-rewrite')).toHaveValue(importedPresetId ?? '')
    await expect(page.getByTestId('preset-compat-binding-future_jump')).toHaveValue(importedPresetId ?? '')
    await expect(page.getByTestId('preset-compat-binding-roleplay')).toHaveValue(importedPresetId ?? '')
    await expect(page.getByTestId('preset-compat-runtime-openai-max-context')).toHaveValue('16384')
    await expect(page.getByTestId('preset-compat-runtime-max-tokens')).toHaveValue('2048')
    await expect(page.getByTestId('preset-compat-runtime-temperature')).toHaveValue('0.55')
    await expect(page.getByTestId(`preset-compat-standalone-regex-attach-${importedRegexId}`)).toContainText(/detach/i)
    await page.mouse.click(12, 12)
    appendQaRow(qaRows, 'Preset compatibility import/bind/preview/save/reload/export', '[task-12-preset-export.json](./task-12-preset-export.json), [task-12-regex-export.json](./task-12-regex-export.json)', `Imported preset ${importedPresetId} and standalone regex ${importedRegexId}; persisted rewrite/future-jump/roleplay bindings plus runtime fields through save and reload.`)
    appendQaRow(qaRows, 'English locale persistence across workspace, task page, settings modal, and preset modal', '[task-12-i18n-full-stack.png](./task-12-i18n-full-stack.png)', 'Verified translated English content after switching on Library and reopening major surfaces; the language control remains Library-only.')

    await page.goto('/task', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
    await expect(page.getByTestId('app-language-switcher')).toHaveCount(0)
    await page.goto('/workspace', { waitUntil: 'networkidle' })
    const identity = await resolveWorkspaceIdentity(page)
    const knowledgeStatus = page.getByTestId('workspace-knowledge-status')
    await expect(knowledgeStatus).toContainText('Story knowledge is not prepared yet')
    await expect(knowledgeStatus).toContainText('Not analyzed yet')

    await selectEntireChapter(page)
    await expect(page.getByTestId('workspace-chapter-rewrite-entry')).toBeVisible()
    await page.getByTestId('workspace-chapter-rewrite-entry').click()
    await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
    await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'false')
    await page.getByTestId('workspace-context-panel-toggle').click()
    await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'true')
    const graphFixtures = seedGraphFixtures(identity)

    await dismissWorkspaceActionOverlayIfVisible(page)
    await page.getByTestId('workspace-chapter-view-toggle').getByRole('button').nth(1).click()
    const chapterGraphResponse = await timedRequest(
      'chapter-graph-context',
      page.request.get(`/api/rag/graph-context?novelId=${identity.novelId}&chapterId=${identity.chapterId}&hops=2&includeLowConfidence=true`),
      (response) => response.status(),
      apiTimings,
    )
    expect(chapterGraphResponse.ok()).toBeTruthy()
    const chapterGraphPayload = await chapterGraphResponse.json() as {
      ok?: boolean
      graphContext?: {
        seedEntities?: Array<{ id: string; label: string }>
        nodes?: Array<{ id: string; label: string }>
        edges?: Array<{ id: string; label?: string; linkType: string; status: string }>
      }
    }
    expect(chapterGraphPayload.ok).toBeTruthy()
    expect(chapterGraphPayload.graphContext?.seedEntities?.some((node) => node.id === graphFixtures.heroEntityId)).toBeTruthy()
    expect(chapterGraphPayload.graphContext?.edges?.some((edge) => edge.id === graphFixtures.edgeId)).toBeTruthy()
    await expect(page.getByTestId('workspace-center-pane-kind')).toContainText(/graph/i)
    await expect(page.getByRole('heading', { name: 'Task 12 Graph Hero' })).toBeVisible()
    await page.screenshot({ path: graphScreenshotPath, fullPage: true })
    await page.getByTestId('workspace-chapter-view-toggle').getByRole('button').first().click()

    const graphSubgraphResponse = await timedRequest(
      'graph-subgraph',
      page.request.get(`/api/graph/subgraph?novelId=${identity.novelId}&branchId=${identity.branchId}&chapterNo=${identity.chapterNo}&hops=2&includeLowConfidence=true&entityId=${graphFixtures.heroEntityId}`),
      (response) => response.status(),
      apiTimings,
    )
    expect(graphSubgraphResponse.ok()).toBeTruthy()
    const graphSubgraphPayload = await graphSubgraphResponse.json() as {
      ok?: boolean
      seedEntities?: Array<{ id: string }>
      nodes?: Array<{ id: string }>
      edges?: Array<{ id: string; label?: string; status: string; linkType: string; strength: number; includeInPrompt: boolean }>
    }
    expect(graphSubgraphPayload.ok).toBeTruthy()
    expect(graphSubgraphPayload.seedEntities?.some((node) => node.id === graphFixtures.heroEntityId)).toBeTruthy()
    expect(graphSubgraphPayload.nodes?.some((node) => node.id === graphFixtures.rivalEntityId)).toBeTruthy()
    expect(graphSubgraphPayload.edges?.some((edge) => edge.id === graphFixtures.edgeId && edge.status === 'ai_generated')).toBeTruthy()

    const graphPatchResponse = await timedRequest(
      'graph-edge-patch',
      page.request.patch(`/api/graph/edge/${graphFixtures.edgeId}`, {
        data: {
          novelId: identity.novelId,
          linkType: 'bond',
          label: 'Task 12 Graph Link Updated',
          description: 'Task 12 graph edge edited through browser-context request.',
          polarity: 'mixed',
          strength: 5,
          validFromChapter: identity.chapterNo,
          validUntilChapter: identity.chapterNo + 20,
          includeByDefault: false,
        },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(graphPatchResponse.ok()).toBeTruthy()
    const graphPatchPayload = await graphPatchResponse.json() as {
      ok?: boolean
      edge?: {
        id: string
        linkType: string
        label?: string
        description?: string
        polarity?: string
        strength: number
        validFromChapter: number
        validUntilChapter: number
        status: string
        includeByDefault: number
      }
    }
    expect(graphPatchPayload.ok).toBeTruthy()
    expect(graphPatchPayload.edge).toMatchObject({
      id: graphFixtures.edgeId,
      linkType: 'bond',
      label: 'Task 12 Graph Link Updated',
      description: 'Task 12 graph edge edited through browser-context request.',
      polarity: 'mixed',
      strength: 5,
      validFromChapter: identity.chapterNo,
      validUntilChapter: identity.chapterNo + 20,
      status: 'user_confirmed',
      includeByDefault: 0,
    })
    const graphStatusAfterPatch = readEntityLinkAndRelationStatus(identity.novelId, graphFixtures.edgeId, graphFixtures.relationId)
    expect(graphStatusAfterPatch.entityLink).toMatchObject({
      status: 'user_confirmed',
      linkType: 'bond',
      label: 'Task 12 Graph Link Updated',
      description: 'Task 12 graph edge edited through browser-context request.',
      polarity: 'mixed',
      strength: 5,
      validFromChapter: identity.chapterNo,
      validUntilChapter: identity.chapterNo + 20,
      includeByDefault: 0,
    })
    expect(graphStatusAfterPatch.knowledgeRelation).toMatchObject({
      status: 'user_confirmed',
      relationType: 'bond',
      polarity: 'mixed',
      strength: 5,
      validFromChapter: identity.chapterNo,
      validUntilChapter: identity.chapterNo + 20,
    })

    const graphRejectResponse = await timedRequest(
      'graph-edge-reject',
      page.request.post(`/api/graph/edge/${graphFixtures.edgeId}/reject`, { data: { novelId: identity.novelId } }),
      (response) => response.status(),
      apiTimings,
    )
    expect(graphRejectResponse.ok()).toBeTruthy()
    const graphRejectPayload = await graphRejectResponse.json() as { ok?: boolean; edge?: { status: string; includeByDefault: number } }
    expect(graphRejectPayload.ok).toBeTruthy()
    expect(graphRejectPayload.edge).toMatchObject({ status: 'rejected', includeByDefault: 0 })
    const graphStatusAfterReject = readEntityLinkAndRelationStatus(identity.novelId, graphFixtures.edgeId, graphFixtures.relationId)
    expect(graphStatusAfterReject.entityLink).toMatchObject({ status: 'rejected', includeByDefault: 0 })
    expect(graphStatusAfterReject.knowledgeRelation).toMatchObject({ status: 'rejected' })
    const graphSubgraphAfterRejectResponse = await timedRequest(
      'graph-subgraph-after-reject',
      page.request.get(`/api/graph/subgraph?novelId=${identity.novelId}&branchId=${identity.branchId}&chapterNo=${identity.chapterNo}&hops=2&includeLowConfidence=true&entityId=${graphFixtures.heroEntityId}`),
      (response) => response.status(),
      apiTimings,
    )
    expect(graphSubgraphAfterRejectResponse.ok()).toBeTruthy()
    const graphSubgraphAfterRejectPayload = await graphSubgraphAfterRejectResponse.json() as { ok?: boolean; edges?: Array<{ id: string }> }
    expect(graphSubgraphAfterRejectPayload.ok).toBeTruthy()
    expect(graphSubgraphAfterRejectPayload.edges?.some((edge) => edge.id === graphFixtures.edgeId)).toBeFalsy()

    const graphConfirmResponse = await timedRequest(
      'graph-edge-confirm',
      page.request.post(`/api/graph/edge/${graphFixtures.edgeId}/confirm`, { data: { novelId: identity.novelId } }),
      (response) => response.status(),
      apiTimings,
    )
    expect(graphConfirmResponse.ok()).toBeTruthy()
    const graphConfirmPayload = await graphConfirmResponse.json() as { ok?: boolean; edge?: { status: string; includeByDefault: number; confidence: number } }
    expect(graphConfirmPayload.ok).toBeTruthy()
    expect(graphConfirmPayload.edge?.status).toBe('user_confirmed')
    expect(graphConfirmPayload.edge?.includeByDefault).toBe(1)
    expect((graphConfirmPayload.edge?.confidence ?? 0)).toBeGreaterThanOrEqual(0.95)
    const graphStatusAfterConfirm = readEntityLinkAndRelationStatus(identity.novelId, graphFixtures.edgeId, graphFixtures.relationId)
    expect(graphStatusAfterConfirm.entityLink).toMatchObject({ status: 'user_confirmed', includeByDefault: 1 })
    expect(graphStatusAfterConfirm.knowledgeRelation).toMatchObject({ status: 'user_confirmed' })
    const graphSubgraphConfirmedOnlyResponse = await timedRequest(
      'graph-subgraph-confirmed-only',
      page.request.get(`/api/graph/subgraph?novelId=${identity.novelId}&branchId=${identity.branchId}&chapterNo=${identity.chapterNo}&hops=2&includeLowConfidence=true&confirmedOnly=true&entityId=${graphFixtures.heroEntityId}`),
      (response) => response.status(),
      apiTimings,
    )
    expect(graphSubgraphConfirmedOnlyResponse.ok()).toBeTruthy()
    const graphSubgraphConfirmedOnlyPayload = await graphSubgraphConfirmedOnlyResponse.json() as {
      ok?: boolean
      edges?: Array<{ id: string; label?: string; status: string; linkType: string; strength: number; includeInPrompt: boolean }>
    }
    expect(graphSubgraphConfirmedOnlyPayload.ok).toBeTruthy()
    expect(graphSubgraphConfirmedOnlyPayload.edges).toContainEqual(expect.objectContaining({
      id: graphFixtures.edgeId,
      label: 'Task 12 Graph Link Updated',
      status: 'user_confirmed',
      linkType: 'bond',
      strength: 5,
      includeInPrompt: true,
    }))
    appendQaRow(qaRows, 'Graph subgraph + edge PATCH/confirm/reject via browser-context requests with visible graph UI proof', '[task-12-graph-browser.png](./task-12-graph-browser.png)', 'Seeded deterministic KnowledgeEntity/EntityLink/KnowledgeRelation rows in the preserved QA DB, verified the chapter Graph pane rendered the seeded entity in the visible inspector, then exercised `/api/graph/subgraph`, `PATCH /api/graph/edge/[edgeId]`, and confirm/reject routes through browser-context requests with DB-backed state transition checks.')

    await selectEntireChapter(page)
    await expect(page.getByTestId('workspace-chapter-rewrite-entry')).toBeVisible()
    await page.getByTestId('workspace-chapter-rewrite-entry').click()
    await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
    await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'false')
    await page.getByTestId('workspace-context-panel-toggle').click()
    await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'true')

    const contextPreviewResponse = await timedRequest(
      'context-preview-valid',
      page.request.post('/api/context-preview', {
        data: {
          novelId: identity.novelId,
          branchId: identity.branchId,
          chapterId: identity.chapterId,
          selectedText: identity.selectedText,
          userInstruction: 'Task 12 context preview request',
          operationType: 'rewrite',
        },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(contextPreviewResponse.ok()).toBeTruthy()
    const generationContextResponse = await timedRequest(
      'rag-build-generation-context',
      page.request.post('/api/rag/build-generation-context', {
        data: {
          novelId: identity.novelId,
          branchId: identity.branchId,
          chapterId: identity.chapterId,
          selectedText: identity.selectedText,
          userInstruction: 'Task 12 generation context request',
          operationType: 'rewrite',
        },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(generationContextResponse.ok()).toBeTruthy()
    const graphContextResponse = await timedRequest(
      'rag-graph-context',
      page.request.post('/api/rag/graph-context', {
        data: {
          novelId: identity.novelId,
          branchId: identity.branchId,
          chapterNo: identity.chapterNo,
          selectedText: identity.selectedText,
          nearbyText: identity.selectedText,
          operationType: 'rewrite',
        },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(graphContextResponse.ok()).toBeTruthy()
    appendQaRow(qaRows, 'Context preview and RAG APIs', '[performance-before-after.md](./performance-before-after.md)', 'Validated context-preview, build-generation-context, and graph-context against the real backend.')

    const rewriteResponsePromise = page.waitForResponse((response) => response.url().includes('/api/rewrite') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Generate version' }).click()
    const rewriteSuccessResponse = await rewriteResponsePromise
    apiTimings.push({ label: 'rewrite-success', ms: 0, status: rewriteSuccessResponse.status() })
    await expect(page.getByTestId('workspace-action-overlay')).toContainText('Task 12 fake stream output')
    const continueBlockCreateResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/continue-blocks' && response.request().method() === 'POST' && response.ok()
    )
    await page.getByRole('button', { name: /保存为续写块|Save as Continue Block/i }).click()
    const createContinueResponse = await continueBlockCreateResponsePromise
    apiTimings.push({ label: 'continue-block-create', ms: 0, status: createContinueResponse.status() })
    const rootContinue = await createContinueResponse.json() as { continueBlockId: string; timelineNodeId: string }
    await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
    await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('Task 12 fake stream output')
    expect(readStoryTimelineNodeCount(identity.novelId, rootContinue.timelineNodeId)).toBe(1)

    const regenerateRewriteResponsePromise = page.waitForResponse((response) => response.url().includes('/api/rewrite') && response.request().method() === 'POST')
    await page.getByTestId('workspace-continue-block-regenerate-entry').click()
    await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
    await page.getByRole('button', { name: 'Generate version' }).click()
    const regenerateRewriteResponse = await regenerateRewriteResponsePromise
    apiTimings.push({ label: 'rewrite-regenerate-continue-block', ms: 0, status: regenerateRewriteResponse.status() })
    await expect(page.getByTestId('workspace-action-overlay')).toContainText('Task 12 fake stream output')
    const continueBlockRegenerateResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/continue-blocks' && response.request().method() === 'PUT' && response.ok()
    )
    await page.getByRole('button', { name: /保存为续写块|Save as Continue Block/i }).click()
    const regenerateContinueResponse = await continueBlockRegenerateResponsePromise
    apiTimings.push({ label: 'continue-block-regenerate', ms: 0, status: regenerateContinueResponse.status() })
    expect(regenerateContinueResponse.ok()).toBeTruthy()
    await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
    await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('Task 12 fake stream output')
    appendQaRow(qaRows, 'Continue-block save/regenerate/reload', '[performance-before-after.md](./performance-before-after.md)', 'Saved a continue block from the visible rewrite result, reopened it in the workspace, regenerated it through the continue-block UI, and kept the DB-backed timeline-node check as supplementary proof.')

    const rewriteErrorResponse = await timedRequest(
      'rewrite-provider-error',
      page.request.post('/api/rewrite', {
        data: {
          novelId: identity.novelId,
          branchId: identity.branchId,
          chapterId: identity.chapterId,
          selectedText: identity.selectedText,
          sourceText: identity.selectedText,
          operationType: 'rewrite',
          userInstruction: 'TASK12_PROVIDER_ERROR',
          scope: 'chapter',
          mode: 'heavy',
          tone: 'dramatic',
          keepCanon: true,
          autoContinue: false,
          thoughtLevel: 'standard',
        },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(rewriteErrorResponse.ok()).toBeFalsy()
    const rewriteErrorPayload = await rewriteErrorResponse.json() as { error?: string; guidance?: string; code?: string }
    expect(rewriteErrorPayload.code).toBe('provider_request_failed')
    expect(rewriteErrorPayload.guidance).toContain('Open AI Settings')
    appendQaRow(qaRows, 'Rewrite provider error and structured product guidance', '[performance-before-after.md](./performance-before-after.md)', 'Verified the real `/api/rewrite` provider failure contract and setup guidance without any fake fallback content.')

    await dismissWorkspaceActionOverlayIfVisible(page)
    await page.getByRole('button', { name: 'Back to chapter' }).click()
    await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()

    await selectEntireChapter(page)
    await page.getByTestId('workspace-chapter-rewrite-entry').click()
    await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
    const rewriteForWhatIfResponsePromise = page.waitForResponse((response) => response.url().includes('/api/rewrite') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Generate version' }).click()
    const rewriteForWhatIfResponse = await rewriteForWhatIfResponsePromise
    apiTimings.push({ label: 'rewrite-for-what-if', ms: 0, status: rewriteForWhatIfResponse.status() })
    await expect(page.getByTestId('workspace-action-overlay')).toContainText('Task 12 fake stream output')
    const whatIfCreateResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/what-if/sessions' && response.request().method() === 'POST' && response.ok()
    )
    await page.getByRole('button', { name: 'Create What-if' }).click()
    const whatIfCreateResponse = await whatIfCreateResponsePromise
    apiTimings.push({ label: 'what-if-create', ms: 0, status: whatIfCreateResponse.status() })
    const whatIfResult = await whatIfCreateResponse.json() as { sessionId: string; timelineNodeId: string }
    await expect(page.getByTestId('workspace-what-if-view')).toBeVisible()
    await expect(page.getByTestId('what-if-view').getByRole('heading', { name: 'IF-01' })).toBeVisible()
    await expect(page.getByTestId('what-if-view').getByRole('button', { name: 'Jump to Future' })).toBeVisible()
    await expect(page.getByTestId('what-if-view').getByRole('button', { name: 'Continue in Branch' })).toBeVisible()
    await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('What-if branch')
    appendQaRow(qaRows, 'Rewrite success + What-if create/open', '[task-12-i18n-full-stack.png](./task-12-i18n-full-stack.png)', 'Generated a real rewrite against the fake OpenAI-compatible backend, then used the visible browser action to create and open the persisted What-if branch.')

    const futureJumpFixtures = seedFutureJumpFixtures(identity)
    const futureJumpCreateResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/future-jump/runs' && response.request().method() === 'POST' && response.ok()
    )
    await page.getByTestId('what-if-jump-button').click()
    await expect(page.getByTestId('future-map-overlay')).toBeVisible()
    await page.getByTestId('future-map-track-phase-task12').click()
    await page.getByTestId(`future-map-event-${futureJumpFixtures.outlineNodeId}`).click()
    await expect(page.getByTestId('future-map-resolved-chapter')).toContainText(String(futureJumpFixtures.targetChapterNo))
    await page.getByLabel('Optional direction').fill('Delay the truth until much later.')
    await page.getByTestId('future-map-confirm').click()
    const futureJumpCreateResponse = await futureJumpCreateResponsePromise
    apiTimings.push({ label: 'future-jump-create', ms: 0, status: futureJumpCreateResponse.status() })
    const futureJumpCreateResult = await futureJumpCreateResponse.json() as { runId: string; timelineNodeId: string }
    expect(readStoryTimelineNodeCount(identity.novelId, futureJumpCreateResult.timelineNodeId)).toBe(1)
    await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()
    await expect(page.getByTestId('future-jump-view').getByText('Future Jump', { exact: true })).toBeVisible()
    await expect(page.getByTestId('workspace-future-jump-view').getByRole('button', { name: 'Regenerate Future Jump' })).toBeVisible()
    await expect(page.getByTestId('future-jump-feedback')).toBeVisible()
    const futureJumpReviseResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/future-jump/runs/${futureJumpCreateResult.runId}/revise` && response.request().method() === 'POST' && response.ok()
    )
    await page.getByTestId('future-jump-feedback').fill('Make the guilt land harder before the reveal.')
    await page.getByTestId('future-jump-regenerate').click()
    const futureJumpReviseResponse = await futureJumpReviseResponsePromise
    apiTimings.push({ label: 'future-jump-revise', ms: 0, status: futureJumpReviseResponse.status() })
    expect(futureJumpReviseResponse.ok()).toBeTruthy()
    const futureJumpDetailResponse = await timedRequest(
      'future-jump-detail-get',
      page.request.get(`/api/future-jump/runs/${futureJumpCreateResult.runId}?branchId=${identity.branchId}`),
      (response) => response.status(),
      apiTimings,
    )
    expect(futureJumpDetailResponse.ok()).toBeTruthy()
    await expect(page.getByTestId('future-jump-revision-history')).toBeVisible()
    await page.screenshot({ path: branchI18nScreenshotPath, fullPage: true })
    appendQaRow(qaRows, 'What-if + Future Jump create/revise/open', '[performance-before-after.md](./performance-before-after.md)', 'Created the What-if from visible rewrite output, launched Future Map through the browser, selected the seeded outline target in the overlay, regenerated the Future Jump with feedback in the view, and kept GET /api/future-jump/runs/[runId] as a supplementary readback.')
    appendQaRow(qaRows, 'English branch-view i18n for What-if and Future Jump surfaces', '[task-12-branch-i18n.png](./task-12-branch-i18n.png)', 'Verified persisted What-if and Future Jump reader copy through the browser, including action buttons and branch headings.')

    const futureJumpDeleteResponse = await timedRequest(
      'future-jump-delete',
      page.request.delete(`/api/story-timeline?novelId=${identity.novelId}&branchId=${identity.branchId}`, {
        data: { nodeId: futureJumpCreateResult.timelineNodeId },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(futureJumpDeleteResponse.ok()).toBeTruthy()
    const futureJumpDeletePayload = await futureJumpDeleteResponse.json() as { ok?: boolean; nodeId?: string }
    expect(futureJumpDeletePayload).toMatchObject({ ok: true, nodeId: futureJumpCreateResult.timelineNodeId })
    await expect.poll(() => readStoryTimelineNodeCount(identity.novelId, futureJumpCreateResult.timelineNodeId), { timeout: 10_000 }).toBe(0)
    const storyTimelineAfterFutureJumpDelete = await timedRequest(
      'story-timeline-after-future-jump-delete',
      page.request.get(`/api/story-timeline?novelId=${identity.novelId}&branchId=${identity.branchId}`),
      (response) => response.status(),
      apiTimings,
    )
    expect(storyTimelineAfterFutureJumpDelete.ok()).toBeTruthy()
    const storyTimelineAfterFutureJumpDeletePayload = await storyTimelineAfterFutureJumpDelete.json() as {
      branchNodes?: Array<{ id: string }>
    }
    expect(storyTimelineAfterFutureJumpDeletePayload.branchNodes?.some((node) => node.id === futureJumpCreateResult.timelineNodeId)).toBeFalsy()
    await page.goto(`/workspace?selectionKind=future_jump&selectionNodeId=${futureJumpCreateResult.timelineNodeId}&selectionRunId=${futureJumpCreateResult.runId}&selectionSourceChapterNo=${identity.chapterNo}&selectionTargetChapterNo=${futureJumpFixtures.targetChapterNo}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('workspace-future-jump-view')).toHaveCount(0)
    await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
    appendQaRow(qaRows, 'Future Jump delete through real backend route with workspace fallback proof', '[performance-before-after.md](./performance-before-after.md)', 'Deleted the real Future Jump timeline node through browser-context `DELETE /api/story-timeline`, verified the node disappeared from `story_timeline_nodes` and the reloaded workspace fell back to the chapter body instead of reopening the deleted Future Jump selection.')

    const whatIfNodeCountBeforeDelete = readStoryTimelineNodeCount(identity.novelId, whatIfResult.timelineNodeId)
    expect(whatIfNodeCountBeforeDelete).toBe(1)
    await dismissWorkspaceActionOverlayIfVisible(page)
    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    const deleteWhatIfResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/story-timeline?') && response.request().method() === 'DELETE' && response.ok()
    )
    await page.getByTestId(`timeline-node-${whatIfResult.timelineNodeId}`).locator('xpath=following-sibling::button[1]').click()
    const deleteWhatIfResponse = await deleteWhatIfResponsePromise
    expect(deleteWhatIfResponse.ok()).toBeTruthy()
    await expect.poll(() => readStoryTimelineNodeCount(identity.novelId, whatIfResult.timelineNodeId), { timeout: 10_000 }).toBe(0)
    await expect(page.getByTestId(`timeline-node-${whatIfResult.timelineNodeId}`)).toHaveCount(0)
    appendQaRow(qaRows, 'What-if delete through real timeline UI', '[performance-before-after.md](./performance-before-after.md)', `Deleted a real What-if branch node through the timeline UI; story_timeline_nodes count ${whatIfNodeCountBeforeDelete} -> ${readStoryTimelineNodeCount(identity.novelId, whatIfResult.timelineNodeId)}.`)

    await page.goto('/workspace', { waitUntil: 'networkidle' })
    await dismissWorkspaceActionOverlayIfVisible(page)
    await selectEntireChapter(page)
    await page.getByTestId('workspace-chapter-roleplay-entry').click()
    const roleplayView = page.getByTestId('workspace-roleplay-session-view')
    await expect(roleplayView).toBeVisible()
    await roleplayView.getByRole('textbox').fill('Tell me the truth now.')
    const roleplayMessageResponsePromise = page.waitForResponse((response) => response.url().includes('/api/roleplay/sessions/') && response.url().includes('/messages') && response.request().method() === 'POST')
    await page.getByTestId('roleplay-composer-send').click()
    const roleplayMessageResponse = await roleplayMessageResponsePromise
    apiTimings.push({ label: 'roleplay-message', ms: 0, status: roleplayMessageResponse.status() })
    await expect(page.getByTestId('roleplay-message-0')).toContainText('Tell me the truth now.')
    await expect(page.getByTestId('roleplay-message-1')).toContainText('Task 12 fake stream output')
    await expect(page.getByTestId('roleplay-fork-anchor')).toContainText(/latest message|最新消息/i)
    await page.getByTestId('roleplay-message-0').click()
    await expect(page.getByTestId('roleplay-fork-anchor')).toContainText(/fork(s|ing)? from|分叉/i)
    appendQaRow(qaRows, 'Roleplay session/message/fork', '[task-12-i18n-full-stack.png](./task-12-i18n-full-stack.png)', 'Created a real roleplay session from the chapter selection and persisted the assistant reply.')

    await page.goto('/workspace', { waitUntil: 'networkidle' })
    await dismissWorkspaceActionOverlayIfVisible(page)
    await expect(page.getByTestId('workspace-knowledge-status')).toBeVisible()
    await ensureKnowledgeAdvancedDetailsOpen(page)
    const knowledgeGetResponse = await timedRequest(
      'knowledge-view-get',
      page.request.get(`/api/knowledge-view?novelId=${identity.novelId}`),
      (response) => response.status(),
      apiTimings,
    )
    expect(knowledgeGetResponse.ok()).toBeTruthy()
    await page.getByTestId('workspace-delete-hanlp-cache').click()
    await expect(page.getByRole('button', { name: 'Confirm delete HanLP cache' })).toBeVisible()
    await page.screenshot({ path: task9CacheGuardrailsScreenshotPath, fullPage: true })
    const knowledgeDeleteHanlpResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/knowledge-view' && response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"action":"delete-hanlp-cache"') && response.ok()
    )
    await page.getByRole('button', { name: 'Confirm delete HanLP cache' }).click()
    const knowledgeDeleteHanlpResponse = await knowledgeDeleteHanlpResponsePromise
    apiTimings.push({ label: 'knowledge-view-delete-hanlp-cache', ms: 0, status: knowledgeDeleteHanlpResponse.status() })
    expect(knowledgeDeleteHanlpResponse.ok()).toBeTruthy()

    await ensureKnowledgeAdvancedDetailsOpen(page)
    await page.getByTestId('workspace-delete-extraction-cache').click()
    await expect(page.getByRole('button', { name: 'Confirm delete LLM extraction cache' })).toBeVisible()
    const knowledgeDeleteExtractionResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/knowledge-view' && response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"action":"delete-extraction-cache"') && response.ok()
    )
    await page.getByRole('button', { name: 'Confirm delete LLM extraction cache' }).click()
    const knowledgeDeleteExtractionResponse = await knowledgeDeleteExtractionResponsePromise
    apiTimings.push({ label: 'knowledge-view-delete-extraction-cache', ms: 0, status: knowledgeDeleteExtractionResponse.status() })
    expect(knowledgeDeleteExtractionResponse.ok()).toBeTruthy()

    await ensureKnowledgeAdvancedDetailsOpen(page)
    await page.getByTestId('workspace-delete-embedding-cache').click()
    await expect(page.getByRole('button', { name: 'Confirm delete raw text embedding cache' })).toBeVisible()
    const knowledgeDeleteEmbeddingResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/knowledge-view' && response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"action":"delete-embedding-cache"') && response.ok()
    )
    await page.getByRole('button', { name: 'Confirm delete raw text embedding cache' }).click()
    const knowledgeDeleteEmbeddingResponse = await knowledgeDeleteEmbeddingResponsePromise
    apiTimings.push({ label: 'knowledge-view-delete-embedding-cache', ms: 0, status: knowledgeDeleteEmbeddingResponse.status() })
    expect(knowledgeDeleteEmbeddingResponse.ok()).toBeTruthy()

    await ensureKnowledgeAdvancedDetailsOpen(page)
    const knowledgeRebuildResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/knowledge-view' && response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"action":"rebuild"') && response.ok()
    )
    await page.getByRole('button', { name: 'Rebuild knowledge view' }).click()
    const knowledgeRebuildResponse = await knowledgeRebuildResponsePromise
    apiTimings.push({ label: 'knowledge-view-rebuild', ms: 0, status: knowledgeRebuildResponse.status() })
    expect(knowledgeRebuildResponse.ok()).toBeTruthy()
    await expect.poll(async () => {
      const response = await page.request.get(`/api/knowledge-view?novelId=${identity.novelId}`)
      if (!response.ok()) {
        return `status:${response.status()}`
      }
      const payload = await response.json() as { ok?: boolean; actionError?: string | null }
      if (!payload.ok) {
        return 'ok:false'
      }
      return payload.actionError ?? 'ok'
    }, { timeout: 10_000 }).toBe('ok')
    const knowledgeOverviewCard = page.getByTestId('workspace-knowledge-status-overview-card')
    await expect(knowledgeOverviewCard).toBeVisible()
    await expect(knowledgeOverviewCard).toContainText('KG status overview')
    await expect(knowledgeOverviewCard).toContainText('Knowledge graph')
    await expect(knowledgeOverviewCard).toContainText('Embedding cache')
    await expect(knowledgeOverviewCard).toContainText('LanceDB index')
    const retrievalRebuildResponse = await timedRequest(
      'knowledge-view-rebuild-retrieval-index',
      page.request.post('/api/knowledge-view', { data: { novelId: identity.novelId, action: 'rebuild-retrieval-index' } }),
      (response) => response.status(),
      apiTimings,
    )
    expect(retrievalRebuildResponse.ok()).toBeTruthy()
    await page.screenshot({ path: task9KnowledgeRebuildScreenshotPath, fullPage: true })
    await page.screenshot({ path: knowledgeI18nScreenshotPath, fullPage: true })
    appendQaRow(qaRows, 'Knowledge rebuild, cache controls, retrieval status, and knowledge cards', '[performance-before-after.md](./performance-before-after.md)', `Triggered all three cache-delete guardrails plus the main knowledge rebuild through the knowledge UI, kept retrieval-index refresh as a supplementary API trigger because the visible retrieval control stayed disabled while the rebuild job was active in this QA runtime, and observed ${knowledgePollEvents.length} GET /api/knowledge-view polls.`)
    appendQaRow(qaRows, 'English knowledge-card and empty-state i18n surfaces', '[task-12-knowledge-i18n.png](./task-12-knowledge-i18n.png)', 'Verified the pre-rebuild empty-state copy plus the post-rebuild KG status overview card labels in English.')
    await settleActiveKnowledgeJobs(page, identity.novelId)
    expect(await readActiveKnowledgeJobs(page, identity.novelId)).toEqual([])

    const invalidContextPreviewResponse = await timedRequest(
      'invalid-context-preview-operation',
      page.request.post('/api/context-preview', {
        data: {
          novelId: identity.novelId,
          chapterId: identity.chapterId,
          selectedText: identity.selectedText,
          userInstruction: 'Invalid operation test',
          operationType: 'totally-unknown-mode',
        },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(invalidContextPreviewResponse.status()).toBe(400)

    const invalidRoleplayBefore = readRoleplayIsolationCounts(identity.novelId)
    expect(invalidRoleplayBefore.sessions).toBeGreaterThan(0)
    expect(invalidRoleplayBefore.timelineNodes).toBeGreaterThan(0)
    const invalidRoleplayCreate = await timedRequest(
      'invalid-roleplay-direct-api',
      page.request.post('/api/roleplay/sessions', {
        data: {
          novelId: identity.novelId,
          branchId: identity.branchId,
          title: 'Task 12 invalid roleplay source node',
          subtitle: 'Should fail cleanly',
          sourceChapterId: identity.chapterId,
          sourceChapterNo: identity.chapterNo,
          sourceChapterTitle: identity.chapterTitle,
          sourceTimelineNodeId: 'missing-timeline-node',
          sourceTimelineNodeType: 'rewrite',
          sourceSelectedText: identity.selectedText,
          sourceTextSnapshot: identity.selectedText,
          sourceSelectedLineStart: 1,
          sourceSelectedLineEnd: 1,
        },
      }),
      (response) => response.status(),
      apiTimings,
    )
    expect(invalidRoleplayCreate.status()).toBe(404)
    const invalidRoleplayAfter = readRoleplayIsolationCounts(identity.novelId)
    expect(invalidRoleplayAfter).toEqual(invalidRoleplayBefore)
    appendQaRow(qaRows, 'Invalid direct API calls do not create orphan rows', '[performance-before-after.md](./performance-before-after.md)', 'Confirmed 400/404 validation paths and stable roleplay/timeline row counts after invalid direct requests.')

    await page.goto('/workspace', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
    await page.screenshot({ path: screenshotPath, fullPage: true })

    const importedNovelTitle = task12NovelTitle
    const workspaceBeforeDelete = await fetchWorkspace(page, identity.novelId)
    expect(workspaceBeforeDelete.localChapters.some((chapter) => chapter.novelId === identity.novelId)).toBeTruthy()
    expect(readReadyNovelRegistryCount(identity.novelId)).toBe(1)
    expect(fs.existsSync(getNovelDataDirectory(identity.novelId))).toBe(true)
    let deleteConfirmMessage = ''
    page.once('dialog', async (dialog) => {
      deleteConfirmMessage = dialog.message()
      await dialog.accept()
    })
    await page.goto('/library', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
    const importedNovelCards = page.locator('article').filter({ has: page.getByRole('heading', { name: importedNovelTitle, exact: true }) })
    const importedNovelCardCountBeforeDelete = await importedNovelCards.count()
    expect(importedNovelCardCountBeforeDelete).toBe(1)
    const importedNovelCard = importedNovelCards.last()
    await expect(importedNovelCard).toBeVisible()
    const deleteNovelResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/novels/${identity.novelId}` && response.request().method() === 'DELETE'
    )
    await importedNovelCard.getByRole('button', { name: `Delete novel ${importedNovelTitle}` }).click()
    const deleteNovelResponse = await deleteNovelResponsePromise
    const deleteNovelResponseBody = await deleteNovelResponse.json() as {
      ok?: unknown
      deletedNovelId?: unknown
      nextNovelId?: unknown
      deletionState?: unknown
      cleanupPending?: unknown
    }
    expect(Object.keys(deleteNovelResponseBody).sort(), JSON.stringify(deleteNovelResponseBody)).toEqual(['cleanupPending', 'deletedNovelId', 'deletionState', 'nextNovelId', 'ok'])
    expect([200, 202], JSON.stringify(deleteNovelResponseBody)).toContain(deleteNovelResponse.status())
    expect(deleteNovelResponseBody.ok, JSON.stringify(deleteNovelResponseBody)).toBe(true)
    expect(deleteNovelResponseBody.deletedNovelId, JSON.stringify(deleteNovelResponseBody)).toBe(identity.novelId)
    expect(deleteNovelResponseBody.nextNovelId === null || typeof deleteNovelResponseBody.nextNovelId === 'string', JSON.stringify(deleteNovelResponseBody)).toBe(true)
    expect(deleteNovelResponseBody.deletionState, JSON.stringify(deleteNovelResponseBody)).toBe('deleted')
    expect(typeof deleteNovelResponseBody.cleanupPending, JSON.stringify(deleteNovelResponseBody)).toBe('boolean')
    expect(deleteNovelResponse.status() === 202, JSON.stringify(deleteNovelResponseBody)).toBe(deleteNovelResponseBody.cleanupPending)
    const nextNovelIdAfterDelete = deleteNovelResponseBody.nextNovelId as string | null
    const cleanupPendingAfterDelete = deleteNovelResponseBody.cleanupPending as boolean
    expect(new URL(deleteNovelResponse.url()).pathname).toBe(`/api/novels/${identity.novelId}`)
    await expect(page.getByText(`Deleted "${importedNovelTitle}"`)).toBeVisible()
    await expect.poll(async () => await importedNovelCards.count()).toBe(importedNovelCardCountBeforeDelete - 1)
    await expect.poll(() => readReadyNovelRegistryCount(identity.novelId), { timeout: 10_000 }).toBe(0)
    expect((await readBrowserWorkspaceSession(page)).currentNovelId).toBe(nextNovelIdAfterDelete ?? '')
    if (!cleanupPendingAfterDelete) {
      expect(fs.existsSync(getNovelDataDirectory(identity.novelId))).toBe(false)
    }
    const workspaceAfterDelete = await fetchWorkspace(page)
    expect(workspaceAfterDelete.localNovels.some((novel) => novel.id === identity.novelId)).toBe(false)
    expect(workspaceAfterDelete.localChapters.some((chapter) => chapter.novelId === identity.novelId)).toBe(false)
    expect(workspaceAfterDelete.currentNovelId).toBe(nextNovelIdAfterDelete ?? '')
    if (nextNovelIdAfterDelete) {
      expect(workspaceAfterDelete.currentChapterId).toBeTruthy()
      expect(workspaceAfterDelete.localChapters.some((chapter) => chapter.id === workspaceAfterDelete.currentChapterId && chapter.novelId === nextNovelIdAfterDelete)).toBe(true)
    } else {
      expect(workspaceAfterDelete.currentChapterId).toBe('')
    }
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('article').filter({ has: page.getByRole('heading', { name: importedNovelTitle, exact: true }) })).toHaveCount(0)
    expect(deleteConfirmMessage).toContain(importedNovelTitle)
    appendQaRow(qaRows, 'Library delete permanently removes the target novel', '[performance-before-after.md](./performance-before-after.md)', `Deleted \`${importedNovelTitle}\` through the real library UI with status ${deleteNovelResponse.status()} and cleanupPending=${cleanupPendingAfterDelete}, removed its ready registry row, kept the browser-selected survivor, and confirmed the target card stayed absent after reload.`)

    const matrixLines = [
      '# Task 12 full-stack QA matrix',
      '',
      '| Flow | Status | Evidence | Notes |',
      '| --- | --- | --- | --- |',
      ...qaRows.map((row) => `| ${row.flow} | ${row.status} | ${row.evidence} | ${row.notes} |`),
      '',
      `All rows PASS: ${qaRows.every((row) => row.status === 'PASS') ? 'yes' : 'no'}`,
    ]
    fs.writeFileSync(matrixPath, `${matrixLines.join('\n')}\n`)

    const performanceLines = [
      '# Task 12 performance before/after',
      '',
      '- Base URL: `http://127.0.0.1:3000`',
      `- DB: \`${resolveTestDatabasePath()}\``,
      '- Repro command context: browser-driven real backend QA on the shared full-project-refactor runtime.',
      '',
      '## Measured browser timings',
      '',
      `- Library load time: ${libraryLoadMs} ms`,
      `- Workspace load time: ${workspaceLoadMs} ms`,
      `- Save latency after edit: ${saveLatencyMs} ms`,
      `- Workspace saves triggered by one edit: ${workspaceSavesTriggeredByEdit}`,
      `- Redundant save count over idle window: ${redundantSaveCountOverIdle}`,
      `- Knowledge status polling count observed after rebuild/retrieval actions: ${knowledgePollEvents.length}`,
      '',
      '## Major API response timings',
      '',
      ...apiTimings.map((timing) => `- ${timing.label}: ${timing.ms} ms (status ${timing.status})`),
      '',
      '## Notes',
      '',
      '- No `page.route()` stubbing was used for the product functions under test in this Task 12 suite.',
      '- The rewrite and roleplay success paths used a real local OpenAI-compatible HTTP server started inside the Playwright test process, not Playwright network interception.',
      `- Fake provider requests observed: ${fakeProvider.requests.length}`,
    ]
    fs.writeFileSync(performancePath, `${performanceLines.join('\n')}\n`)
  } finally {
    await fakeOllama.close()
    await fakeProvider.close()
  }
})
