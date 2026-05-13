import { NextResponse } from 'next/server'
import { buildGenerationContextPreview } from '@/lib/server/context-builder'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const preview = await buildGenerationContextPreview({
      novelId: String(body.novelId ?? ''),
      branchId: body.branchId ? String(body.branchId) : undefined,
      chapterId: String(body.chapterId ?? ''),
      selectedText: String(body.selectedText ?? ''),
      operationType: body.operationType ?? 'expand',
      userInstruction: String(body.userInstruction ?? ''),
    })

    return NextResponse.json({ ok: true, preview })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to build generation context',
      },
      { status: 500 }
    )
  }
}
