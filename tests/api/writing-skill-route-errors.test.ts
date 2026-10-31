import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('@/lib/server/writing-skill-store')
  vi.restoreAllMocks()
  vi.resetModules()
})

async function loadJobRoute(readWritingSkillJob: () => unknown) {
  vi.doMock('@/lib/server/writing-skill-store', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/server/writing-skill-store')>(),
    readWritingSkillJob,
  }))
  const { GET } = await import('@/app/api/writing-skill-jobs/[jobId]/route')
  return GET(new Request('http://localhost/api/writing-skill-jobs/job-1'), { params: Promise.resolve({ jobId: 'job-1' }) })
}

describe('writing skill route failures', () => {
  it('reports an internal failure as a JSON 500 without its raw message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await loadJobRoute(() => {
      throw new Error('SQLITE_IOERR: /private/path/control.db')
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Failed to load writing skill job' })
    expect(consoleError).toHaveBeenCalledOnce()
  })

  it('keeps the status and message of an expected failure', async () => {
    const { ResourceNotFoundError } = await import('@/lib/server/domain-errors')
    const response = await loadJobRoute(() => {
      throw new ResourceNotFoundError('写作技巧卡不存在')
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, error: '写作技巧卡不存在' })
  })
})
