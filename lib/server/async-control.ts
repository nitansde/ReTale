export async function sleep(ms: number) {
  if (ms <= 0) {
    return
  }

  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForCondition<T>(params: {
  timeoutMs: number
  pollMs: number
  check: () => Promise<T> | T
  isDone: (value: T) => boolean
}) {
  const startedAt = Date.now()

  while (true) {
    const value = await params.check()
    if (params.isDone(value)) {
      return { timedOut: false as const, value }
    }

    const remainingMs = params.timeoutMs - (Date.now() - startedAt)
    if (remainingMs <= 0) {
      return { timedOut: true as const, value }
    }

    await sleep(Math.min(params.pollMs, remainingMs))
  }
}

export async function withScopedAsyncLock<T>(locks: Map<string, Promise<void>>, key: string, callback: () => Promise<T>) {
  const previousLock = locks.get(key) ?? Promise.resolve()
  let releaseLock: () => void = () => undefined
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  const nextLock = previousLock.catch(() => undefined).then(() => currentLock)
  locks.set(key, nextLock)

  await previousLock.catch(() => undefined)
  try {
    return await callback()
  } finally {
    releaseLock()
    if (locks.get(key) === nextLock) {
      locks.delete(key)
    }
  }
}
