import { AsyncLocalStorage } from 'node:async_hooks'

const perNovelWriteGateTails = new Map<string, Promise<void>>()
const perNovelWriteGateScope = new AsyncLocalStorage<ReadonlySet<string>>()

export async function runWithPerNovelWriteGate<T>(novelId: string, callback: () => T | Promise<T>) {
  const ownedNovelIds = perNovelWriteGateScope.getStore()
  if (ownedNovelIds?.has(novelId)) {
    return callback()
  }

  const previousTail = perNovelWriteGateTails.get(novelId) ?? Promise.resolve()
  let releaseCurrentTail!: () => void
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrentTail = resolve
  })
  const queuedTail = previousTail.catch(() => undefined).then(() => currentTail)
  perNovelWriteGateTails.set(novelId, queuedTail)

  await previousTail.catch(() => undefined)

  try {
    return await perNovelWriteGateScope.run(new Set([...(ownedNovelIds ?? []), novelId]), callback)
  } finally {
    releaseCurrentTail()
    if (perNovelWriteGateTails.get(novelId) === queuedTail) {
      perNovelWriteGateTails.delete(novelId)
    }
  }
}

export function resetPerNovelWriteGatesForTests() {
  perNovelWriteGateTails.clear()
}
