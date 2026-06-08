import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

class MockChildProcess extends EventEmitter {
  unref() {}
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('knowledge worker scheduler', () => {
  it('allows retry scheduling for the same job id when the attempt id changes', async () => {
    const spawnMock = vi.fn(() => new MockChildProcess())
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    const scheduler = await import('@/lib/server/knowledge-worker-scheduler')
    scheduler.resetScheduledKnowledgeWorkerJobsForTesting()

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      jobId: 'job-1',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-1',
      allowInTests: true,
    })).toBe(true)

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      jobId: 'job-1',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-1',
      allowInTests: true,
    })).toBe(false)

    expect(scheduler.scheduleKnowledgeWorkerProcess({
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      jobId: 'job-1',
      jobType: 'extract_chapter_knowledge',
      attemptId: 'attempt-2',
      allowInTests: true,
    })).toBe(true)

    expect(spawnMock).toHaveBeenCalledTimes(2)
  })
})
