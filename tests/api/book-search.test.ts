import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { registerNovelDatabaseFixture } from '@/tests/helpers/novel-db'
import { connectRetrievalDatabase } from '@/lib/server/retrieval-runtime'
import { getBookSearchCapabilities, searchBook } from '@/lib/server/book-search'
import { GET } from '@/app/api/novels/[novelId]/search/route'
import { BOOK_SEARCH_RESULT_LIMIT } from '@/lib/book-search'
import { createContinueBlockFromRewrite } from '@/lib/server/continue-block-service'

const mocks = vi.hoisted(() => ({ embed: vi.fn(), providerModel: 'test-embedding' }))
vi.mock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => ({
  embeddings: { provider: 'ollama', ollama: { model: mocks.providerModel } },
}) }))
vi.mock('@/lib/server/ollama-local', () => ({ embedTextsWithOllama: mocks.embed }))

let database: DatabaseSync
let dispose: () => void
const novelId = 'search-novel'
const branchId = `${novelId}:main`

beforeEach(() => {
  database = initializeDatabase(new DatabaseSync(path.join(process.env.TMPDIR!, `book-search-${randomUUID()}.db`)))
  database.prepare("INSERT INTO WorkspaceRuntimeState (id) VALUES ('singleton')").run()
  database.prepare('INSERT INTO NovelRecord (id, title) VALUES (?, ?)').run(novelId, 'Search book')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(branchId, novelId, 'main')
  dispose = registerNovelDatabaseFixture(database, [novelId])
  mocks.providerModel = 'test-embedding'
  mocks.embed.mockReset().mockResolvedValue({ enabled: true, embeddings: [[1, 0, 0]] })
})
afterEach(() => { dispose?.(); database?.close() })

function chapter(id: string, title: string, text: string, order = 1, owner = novelId) {
  database.prepare(`INSERT INTO WorkspaceRuntimeChapter (id, novelId, title, contentHtml, sortOrder)
    VALUES (?, ?, ?, ?, ?)`).run(id, owner, title, text, order)
}
async function vectors(entries: Array<{ chapterId: string; text: string; vector: number[]; sourceType?: string }>, scope = 'full') {
  const name = `retrieval_docs_${createHash('sha256').update(branchId).digest('hex').slice(0, 16)}_${randomUUID().replaceAll('-', '')}`
  const db = await connectRetrievalDatabase(novelId)
  await db.createTable(name, entries.map((entry, index) => ({
    ...entry, id: `${name}:${index}`, sourceId: `span-${index}`, sourceType: entry.sourceType ?? 'text_span',
    branchId, chapterNo: 1, lineStart: 1, lineEnd: 1, title: 'passage', sourceLabel: 'passage',
    embeddingProvider: 'ollama', embeddingModel: 'test-embedding', embeddingDimension: 3,
  })))
  database.prepare('INSERT INTO ActiveRetrievalIndex (branchId, scopeKey, tableName) VALUES (?, ?, ?)').run(branchId, scope, name)
}

async function request(query: string, id = novelId, mode?: string) {
  return GET(new Request(`http://localhost/api/novels/${id}/search?${new URLSearchParams({ q: query, ...(mode ? { mode } : {}) })}`), {
    params: Promise.resolve({ novelId: id }),
  })
}

describe('book search', () => {
  it('searches saved Chinese and case-insensitive text without knowledge or embeddings, scoped to the book', async () => {
    chapter('one', '山中来客', '<p>林舟找到了失落的宝剑 &amp; Map。</p>')
    chapter('foreign', '别的书', '<p>失落的宝剑</p>', 1, 'other-book')
    const response = await request('宝剑 & map')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const result = await response.json()
    expect(result.mode).toBe('exact')
    expect(result.fallbackReason).toBe('missing_embedding')
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ chapterId: 'one', text: '林舟找到了失落的宝剑 & Map。', kind: 'exact' })
    expect((await searchBook(novelId, '山中来客')).matches[0].chapterId).toBe('one')
    expect(mocks.embed).not.toHaveBeenCalled()
    expect(await getBookSearchCapabilities(novelId)).toEqual({ semanticAvailable: false })
  })

  it('uses existing vectors to find related passages without literal query overlap and jumps to original text', async () => {
    chapter('one', '夜行', '<p>他独自穿过寂静的森林。</p>')
    chapter('two', '早饭', '<p>桌上摆着热气腾腾的包子。</p>', 2)
    await vectors([
      { chapterId: 'two', text: '桌上摆着热气腾腾的包子。', vector: [0, 1, 0] },
      { chapterId: 'one', text: '他独自穿过寂静的森林。', vector: [1, 0, 0] },
      { chapterId: 'one', text: '不是正文的角色摘要', vector: [1, 0, 0], sourceType: 'entity_profile' },
    ], 'chapter-range:1:2')
    expect(await getBookSearchCapabilities(novelId)).toEqual({ semanticAvailable: true })
    expect(mocks.embed).not.toHaveBeenCalled()
    const result = await searchBook(novelId, '孤独的旅程')
    expect(result.mode).toBe('semantic')
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toMatchObject({ chapterId: 'one', searchText: '他独自穿过寂静的森林。', kind: 'semantic' })
    expect(mocks.embed).toHaveBeenCalledTimes(1)
  })

  it('falls back when the provider fails, and never uses vectors from a changed model', async () => {
    chapter('one', '夜行', '<p>他独自穿过森林。</p>')
    await vectors([{ chapterId: 'one', text: '他独自穿过森林。', vector: [1, 0, 0] }])
    mocks.embed.mockRejectedValueOnce(new Error('provider unavailable'))
    expect(await searchBook(novelId, '森林')).toMatchObject({ mode: 'exact', fallback: true, matches: [{ chapterId: 'one' }] })
    mocks.providerModel = 'different-model-same-dimensions'
    expect(await searchBook(novelId, '森林')).toMatchObject({ mode: 'exact', matches: [{ chapterId: 'one' }] })
    expect(mocks.embed).toHaveBeenCalledTimes(1)
  })

  it('filters stale/deleted vector matches and includes keywords from unindexed chapters', async () => {
    chapter('one', '新正文', '<p>已经改成雨天。</p>')
    chapter('two', '尚未索引', '<p>雨天走进村庄。</p>', 2)
    await vectors([
      { chapterId: 'one', text: '以前是晴天。', vector: [1, 0, 0] },
      { chapterId: 'deleted', text: '雨天的旧章节。', vector: [1, 0, 0] },
    ])
    const result = await searchBook(novelId, '雨天')
    expect(result.matches.map((match) => match.chapterId)).toEqual(['one', 'two'])
    expect(result.matches.every((match) => match.kind === 'exact')).toBe(true)
  })

  it('bounds results across chapter batches and treats regex/SQL characters literally', async () => {
    for (let i = 1; i <= 75; i++) chapter(`chapter-${i}`, `第${i}章`, '<p>相同关键词</p>', i)
    chapter('last', '最后', '<p>100% [test].*</p>', 80)
    const result = await searchBook(novelId, '关键词')
    expect(result.matches).toHaveLength(BOOK_SEARCH_RESULT_LIMIT)
    expect(result.limited).toBe(true)
    expect((await searchBook(novelId, '[test].*')).matches[0].chapterId).toBe('last')
    expect((await searchBook(novelId, "' OR 1=1 --")).matches).toEqual([])
  })

  it('explicit exact mode bypasses existing embeddings and matches a whole literal phrase', async () => {
    chapter('literal', 'A quiet night', '<p>They saw a RED FOX near the village.</p>')
    chapter('separate', 'Forest', '<p>The red bird flew past a fox.</p>', 2)
    chapter('reversed', 'Forest', '<p>A fox was red.</p>', 3)
    await vectors([{ chapterId: 'separate', text: 'The red bird flew past a fox.', vector: [1, 0, 0] }])
    const response = await request('red fox', novelId, 'exact')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ mode: 'exact', fallback: false, matches: [{ chapterId: 'literal', kind: 'exact' }] })
    expect(mocks.embed).not.toHaveBeenCalled()
    expect((await request('fox red', novelId, 'exact')).status).toBe(200)
    expect((await searchBook(novelId, 'quiet night', 'exact')).matches[0].chapterId).toBe('literal')
  })

  it('finds saved rewrites and legacy branches, keeping their own navigation targets', async () => {
    chapter('one', '原文', '<p>他走进森林。</p>')
    chapter('legacy', '旧改写分支', '<p>旧式改写的银色罗盘。</p>', 1.1)
    database.prepare('UPDATE WorkspaceRuntimeChapter SET parentChapterId = ? WHERE id = ?').run('one', 'legacy')
    const saved = await createContinueBlockFromRewrite({
      novelId, branchId, sourceChapterNo: 1, selectedText: '森林', originalText: '他走进森林。',
      generatedText: '改写后，他拿着银色罗盘穿过森林。', userInstruction: '加入罗盘',
      writingSkillCardIds: [], writingSkillExampleCount: 5, titleHint: '改写的旅程',
    })
    const continuation = await createContinueBlockFromRewrite({
      novelId, branchId, sourceChapterNo: 1, parentTimelineNodeId: saved.timelineNodeId,
      selectedText: '森林', originalText: '他走进森林。',
      generatedText: '银色罗盘指向了村庄。', userInstruction: '继续前进',
      writingSkillCardIds: [], writingSkillExampleCount: 5,
    })
    const result = await searchBook(novelId, '银色罗盘', 'exact')
    expect(result.matches).toHaveLength(3)
    expect(result.matches.find((match) => match.chapterId === 'legacy')).toMatchObject({ sourceType: 'rewrite', chapterNo: 1 })
    expect(result.matches.find((match) => match.selection?.nodeId === saved.timelineNodeId)).toMatchObject({
      sourceType: 'rewrite', kind: 'exact', selection: { kind: 'rewrite', continueBlockId: saved.continueBlockId, anchorChapterNo: 1 },
    })
    expect(result.matches.find((match) => match.selection?.nodeId === continuation.timelineNodeId)).toMatchObject({ sourceType: 'continue_block' })
    database.prepare('UPDATE continue_blocks SET latest_text = ? WHERE id = ?').run('最新版本只有金色地图。', saved.continueBlockId)
    database.prepare('DELETE FROM story_timeline_nodes WHERE id = ?').run(continuation.timelineNodeId)
    expect((await searchBook(novelId, '银色罗盘', 'exact')).matches).toHaveLength(1)
    expect((await searchBook(novelId, '金色地图', 'exact')).matches[0].selection?.nodeId).toBe(saved.timelineNodeId)
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('rejects empty/oversized queries and nonexistent novels', async () => {
    expect((await request('hello', novelId, 'unsupported')).status).toBe(400)
    expect((await request('  ')).status).toBe(400)
    expect((await request('a'.repeat(201))).status).toBe(400)
    expect((await request('hello', 'does-not-exist')).status).toBe(404)
  })
})
