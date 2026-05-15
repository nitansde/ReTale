import { NextResponse } from 'next/server'
import { createWhatIfSessionFromRewrite } from '@/lib/server/what-if-service'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await createWhatIfSessionFromRewrite({
      novelId: String(body.novelId ?? ''),
      branchId: String(body.branchId ?? ''),
      sourceChapterNo: Number(body.sourceChapterNo ?? 0),
      selectedText: String(body.selectedText ?? ''),
      originalText: String(body.originalText ?? ''),
      generatedText: String(body.generatedText ?? ''),
      userInstruction: String(body.userInstruction ?? ''),
      titleHint: typeof body.titleHint === 'string' ? body.titleHint : null,
      subtitleHint: typeof body.subtitleHint === 'string' ? body.subtitleHint : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create what-if session'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
