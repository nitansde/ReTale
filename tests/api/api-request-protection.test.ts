import { describe, expect, it } from 'vitest'
import { POST as saveSettings } from '@/app/api/settings/ai/route'
import { POST as rewrite } from '@/app/api/rewrite/route'
import { POST as preview } from '@/app/api/context-preview/route'
import { POST as buildContext } from '@/app/api/rag/build-generation-context/route'
import { POST as graphContext } from '@/app/api/rag/graph-context/route'
import { POST as knowledgeView } from '@/app/api/knowledge-view/route'
import { POST as savePresets } from '@/app/api/settings/preset-compat/route'
import { POST as importPresets } from '@/app/api/settings/preset-compat/import/route'
import { POST as createWhatIf } from '@/app/api/what-if/sessions/route'
import { POST as abortTask } from '@/app/api/task/route'
import { GET as getTask } from '@/app/api/task/route'
import { GET as getKnowledgeView } from '@/app/api/knowledge-view/route'
import { POST as createContinueBlock } from '@/app/api/continue-blocks/route'

const routes = [
  ['/api/settings/ai', saveSettings],
  ['/api/rewrite', rewrite],
  ['/api/context-preview', preview],
  ['/api/rag/build-generation-context', buildContext],
  ['/api/rag/graph-context', graphContext],
  ['/api/knowledge-view', knowledgeView],
  ['/api/settings/preset-compat', savePresets],
  ['/api/settings/preset-compat/import', importPresets],
  ['/api/what-if/sessions', createWhatIf],
  ['/api/task', abortTask],
] as const

describe('JSON request errors at route boundaries', () => {
  it.each([getTask, getKnowledgeView])('returns 400 for an invalid novel ID', async (handler) => {
    for (const novelId of ['../../etc', '\u0000', 'novel/child']) {
      const response = await handler(new Request(`http://localhost/api/test?novelId=${encodeURIComponent(novelId)}`))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Invalid novel ID') })
    }
  })

  it.each([createWhatIf, createContinueBlock])('returns a concise validation message and a consistent envelope', async (handler) => {
    const response = await handler(new Request('http://localhost/api/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, error: expect.stringContaining('novelId:') })
    expect(body.error).not.toContain('"code"')
    expect(body.error.length).toBeLessThan(200)
  })

  it.each(routes)('%s rejects simple text/plain requests before domain work', async (path, handler) => {
    const response = await handler(new Request(`http://localhost${path}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    }))
    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'Content-Type must be application/json' })
  })

  it.each(routes)('%s preserves 413 rather than translating it to 400 or 500', async (path, handler) => {
    const response = await handler(new Request(`http://localhost${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(17 * 1024 * 1024) }, body: '{}',
    }))
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
  })
})
