import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const afterCallbacks: Array<() => Promise<void>> = []
const claimPendingWorkspaceKnowledgeSync = vi.fn()
const completeWorkspaceKnowledgeSync = vi.fn()
const failWorkspaceKnowledgeSync = vi.fn()
const workspaceKnowledgeSyncNeedsScheduling = vi.fn()
const resumePendingWorkspaceNovelCleanup = vi.fn(async () => {})
const resumeWorkspaceNovelCleanup = vi.fn(async () => {})
const loadWorkspaceKnowledgeSyncPayload = vi.fn()
const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

vi.mock('next/server', () => ({
  after: vi.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}))
vi.mock('@/lib/server/database-access', () => ({
  createNovelDatabaseAccess: vi.fn((novelId: string) => ({ novelId })),
}))
vi.mock('@/lib/server/knowledge-rebuild', () => ({ syncWorkspacePayloadToKnowledgeStore }))
vi.mock('@/lib/server/persistence', () => ({
  claimPendingWorkspaceKnowledgeSync,
  completeWorkspaceKnowledgeSync,
  failWorkspaceKnowledgeSync,
  workspaceKnowledgeSyncNeedsScheduling,
  resumePendingWorkspaceNovelCleanup,
  resumeWorkspaceNovelCleanup,
}))
vi.mock('@/lib/server/workspace-resilience', () => ({ loadWorkspaceKnowledgeSyncPayload }))

const background = await import('@/lib/server/workspace-background')

function createClaim(revision: number) {
  return {
    workspaceStateId: 'singleton',
    revision,
    sourceUpdatedAt: `updated-${revision}`,
    claimToken: `claim-${revision}`,
  }
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
  afterCallbacks.length = 0
  claimPendingWorkspaceKnowledgeSync.mockReset()
  completeWorkspaceKnowledgeSync.mockReset()
  failWorkspaceKnowledgeSync.mockReset()
  workspaceKnowledgeSyncNeedsScheduling.mockReset()
  resumePendingWorkspaceNovelCleanup.mockClear()
  resumeWorkspaceNovelCleanup.mockClear()
  loadWorkspaceKnowledgeSyncPayload.mockReset()
  syncWorkspacePayloadToKnowledgeStore.mockReset().mockResolvedValue(undefined)
  background.resetWorkspaceBackgroundSchedulingForTests()
})

afterEach(() => {
  background.resetWorkspaceBackgroundSchedulingForTests()
  vi.unstubAllEnvs()
})

describe('workspace background scheduling', () => {
  it('coalesces rapid and active knowledge sync scheduling while the durable loop drains newer claims', async () => {
    const firstSync = Promise.withResolvers<void>()
    const claims = [createClaim(1)]
    claimPendingWorkspaceKnowledgeSync.mockImplementation(() => claims.shift() ?? null)
    loadWorkspaceKnowledgeSyncPayload.mockImplementation((_id, db: { novelId: string }) => ({
      currentNovelId: db.novelId,
      localNovels: [],
      localChapters: [],
    }))
    syncWorkspacePayloadToKnowledgeStore.mockImplementationOnce(() => firstSync.promise)

    background.scheduleWorkspaceKnowledgeSync('novel-1')
    background.scheduleWorkspaceKnowledgeSync('novel-1')
    expect(afterCallbacks).toHaveLength(1)

    const running = afterCallbacks[0]()
    await vi.waitFor(() => expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1))
    claims.push(createClaim(2))
    background.scheduleWorkspaceKnowledgeSync('novel-1')
    expect(afterCallbacks).toHaveLength(1)

    firstSync.resolve()
    await running

    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(2)
    expect(completeWorkspaceKnowledgeSync).toHaveBeenNthCalledWith(
      2,
      createClaim(2),
      { db: { novelId: 'novel-1' } },
    )
  })

  it('releases a failed knowledge sync so a later mutation can schedule again', async () => {
    claimPendingWorkspaceKnowledgeSync
      .mockReturnValueOnce(createClaim(1))
      .mockReturnValueOnce(createClaim(2))
      .mockReturnValue(null)
    loadWorkspaceKnowledgeSyncPayload.mockReturnValue(null)
    const syncError = new Error('sync failed')
    syncWorkspacePayloadToKnowledgeStore
      .mockRejectedValueOnce(syncError)
      .mockResolvedValueOnce(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    background.scheduleWorkspaceKnowledgeSync('novel-1')
    await afterCallbacks[0]()
    background.scheduleWorkspaceKnowledgeSync('novel-1')

    expect(afterCallbacks).toHaveLength(2)
    await afterCallbacks[1]()
    expect(failWorkspaceKnowledgeSync).toHaveBeenCalledWith(createClaim(1), 'sync failed', { db: { novelId: 'novel-1' } })
    expect(completeWorkspaceKnowledgeSync).toHaveBeenCalledWith(createClaim(2), { db: { novelId: 'novel-1' } })
  })

  it('drains a wake scheduled during the final null-claim handoff', async () => {
    claimPendingWorkspaceKnowledgeSync
      .mockImplementationOnce(() => {
        background.scheduleWorkspaceKnowledgeSync('novel-1')
        return null
      })
      .mockReturnValueOnce(createClaim(2))
      .mockReturnValue(null)
    loadWorkspaceKnowledgeSyncPayload.mockReturnValue(null)

    background.scheduleWorkspaceKnowledgeSync('novel-1')
    await afterCallbacks[0]()

    expect(afterCallbacks).toHaveLength(1)
    expect(completeWorkspaceKnowledgeSync).toHaveBeenCalledWith(
      createClaim(2),
      { db: { novelId: 'novel-1' } },
    )
  })

  it('schedules durable recovery only when the read-only state check is claimable', () => {
    workspaceKnowledgeSyncNeedsScheduling.mockReturnValueOnce(false).mockReturnValueOnce(true)

    expect(background.scheduleWorkspaceKnowledgeSyncRecovery('novel-1')).toBe(false)
    expect(afterCallbacks).toHaveLength(0)
    expect(background.scheduleWorkspaceKnowledgeSyncRecovery('novel-1')).toBe(true)
    expect(afterCallbacks).toHaveLength(1)
  })

  it('coalesces global cleanup scans and per-novel cleanup retries independently', async () => {
    background.schedulePendingWorkspaceNovelCleanupScan()
    background.schedulePendingWorkspaceNovelCleanupScan()
    background.scheduleWorkspaceNovelCleanup('novel-1')
    background.scheduleWorkspaceNovelCleanup('novel-1')
    background.scheduleWorkspaceNovelCleanup('novel-2')

    expect(afterCallbacks).toHaveLength(3)
    await Promise.all(afterCallbacks.map((callback) => callback()))

    background.schedulePendingWorkspaceNovelCleanupScan()
    background.scheduleWorkspaceNovelCleanup('novel-1')
    expect(afterCallbacks).toHaveLength(5)
    expect(resumePendingWorkspaceNovelCleanup).toHaveBeenCalledTimes(1)
    expect(resumeWorkspaceNovelCleanup).toHaveBeenCalledTimes(2)
  })

  it('observes timer-fallback callback rejections with fixed context', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const error = new Error('timer failure')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    background.scheduleAfterResponse(async () => {
      throw error
    })

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Workspace background task failed after timer fallback:', error)
    })
  })
})
