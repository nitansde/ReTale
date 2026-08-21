import { NextResponse } from 'next/server'
import { patchChapterResource } from '@/lib/server/novel-resource-handlers'

export const maxDuration = 3600

export async function PATCH(request: Request, context: { params: Promise<{ chapterId: string }> }) {
  const { chapterId: rawChapterId } = await context.params
  const chapterId = rawChapterId.trim()
  if (!chapterId) return NextResponse.json({ ok: false, error: 'chapterId is required' }, { status: 400 })
  return patchChapterResource(request, chapterId)
}
