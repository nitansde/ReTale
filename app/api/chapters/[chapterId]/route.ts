import { NextResponse } from 'next/server'
import { PATCH as patchLegacyWorkspace } from '@/app/api/workspace/route'

export const maxDuration = 3600

function forwardRequestWithHeaders(request: Request, headers: Headers) {
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    duplex: 'half',
  }
  return new Request(request.url, init)
}

export async function PATCH(request: Request, context: { params: Promise<{ chapterId: string }> }) {
  const { chapterId: rawChapterId } = await context.params
  const chapterId = rawChapterId.trim()
  if (!chapterId) return NextResponse.json({ ok: false, error: 'chapterId is required' }, { status: 400 })
  const headers = new Headers(request.headers)
  headers.set('X-Retale-Resource-Chapter-Id', chapterId)
  return patchLegacyWorkspace(forwardRequestWithHeaders(request, headers))
}
