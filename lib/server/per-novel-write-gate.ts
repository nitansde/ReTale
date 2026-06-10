const perNovelWriteGateTails = new Map<string, Promise<void>>()

export async function runWithPerNovelWriteGate<T>(novelId: string, callback: () => T | Promise<T>) {
  const previousTail = perNovelWriteGateTails.get(novelId) ?? Promise.resolve()
  let releaseCurrentTail!: () => void
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrentTail = resolve
  })
  const queuedTail = previousTail.catch(() => undefined).then(() => currentTail)
  perNovelWriteGateTails.set(novelId, queuedTail)

  await previousTail.catch(() => undefined)

  try {
    return await callback()
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
