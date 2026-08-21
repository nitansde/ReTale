import { GET as getLegacyWorkspace } from '@/app/api/workspace/route'

export const maxDuration = 3600

export async function GET(request: Request) {
  const url = new URL('/api/workspace', request.url)
  url.searchParams.set('librarySummary', '1')
  const response = await getLegacyWorkspace(new Request(url, {
    headers: request.headers,
    signal: request.signal,
  }))
  if (!response.ok) return response

  const payload = await response.json() as { ok?: unknown; novels?: unknown }
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json({ ok: payload.ok, novels: payload.novels }, {
    status: response.status,
    headers,
  })
}
