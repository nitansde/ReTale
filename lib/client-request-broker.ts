type ClientGetOptions<T> = {
  cache?: RequestCache
  signal?: AbortSignal
  timeoutMs?: number
  parse: (response: Response) => Promise<T>
}

type InFlightEntry<T> = {
  controller: AbortController
  consumers: number
  settled: boolean
  promise: Promise<T>
  timeoutId: ReturnType<typeof globalThis.setTimeout> | null
}

const inFlightGets = new Map<string, InFlightEntry<unknown>>()

export function normalizeClientGetKey(url: string, cache: RequestCache = 'no-store') {
  const parsed = new URL(url, 'http://client.local')
  const sorted = Array.from(parsed.searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  parsed.search = ''
  for (const [key, value] of sorted) parsed.searchParams.append(key, value)
  return `GET ${parsed.pathname}${parsed.search} cache=${cache}`
}

function acquireClientGet<T>(url: string, options: ClientGetOptions<T>) {
  const cache = options.cache ?? 'no-store'
  const key = normalizeClientGetKey(url, cache)
  let entry = inFlightGets.get(key) as InFlightEntry<T> | undefined

  if (!entry) {
    const controller = new AbortController()
    const timeoutId = options.timeoutMs
      ? globalThis.setTimeout(() => controller.abort(), options.timeoutMs)
      : null
    entry = {
      controller,
      consumers: 0,
      settled: false,
      timeoutId,
      promise: fetch(url, { cache, signal: controller.signal }).then(options.parse),
    }
    inFlightGets.set(key, entry as InFlightEntry<unknown>)
    void entry.promise.finally(() => {
      entry!.settled = true
      if (entry!.timeoutId) globalThis.clearTimeout(entry!.timeoutId)
      if (inFlightGets.get(key) === entry) inFlightGets.delete(key)
    }).catch(() => undefined)
  }

  entry.consumers += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    entry!.consumers -= 1
    queueMicrotask(() => {
      if (!entry!.settled && entry!.consumers === 0) entry!.controller.abort()
    })
  }
  return { promise: entry.promise, release }
}

export async function requestClientGet<T>(url: string, options: ClientGetOptions<T>): Promise<T> {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const consumer = acquireClientGet(url, options)
  let rejectAbort: ((reason: DOMException) => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const releaseOnAbort = () => {
    consumer.release()
    rejectAbort?.(new DOMException('Aborted', 'AbortError'))
  }
  options.signal?.addEventListener('abort', releaseOnAbort, { once: true })
  try {
    return await (options.signal ? Promise.race([consumer.promise, aborted]) : consumer.promise)
  } finally {
    options.signal?.removeEventListener('abort', releaseOnAbort)
    consumer.release()
  }
}

export function resetClientRequestBrokerForTests() {
  for (const entry of inFlightGets.values()) entry.controller.abort()
  inFlightGets.clear()
}
