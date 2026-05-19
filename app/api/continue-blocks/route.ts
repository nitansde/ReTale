import { NextResponse } from 'next/server'
import { createContinueBlockFromRewrite, regenerateContinueBlock } from '@/lib/server/continue-block-service'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await createContinueBlockFromRewrite({
      novelId: String(body.novelId ?? ''),
      branchId: String(body.branchId ?? ''),
      sourceChapterNo: Number(body.sourceChapterNo ?? 0),
      parentTimelineNodeId: typeof body.parentTimelineNodeId === 'string' ? body.parentTimelineNodeId : null,
      selectedText: String(body.selectedText ?? ''),
      originalText: String(body.originalText ?? ''),
      generatedText: String(body.generatedText ?? ''),
      inputTokens: typeof body.inputTokens === 'number' ? body.inputTokens : null,
      outputTokens: typeof body.outputTokens === 'number' ? body.outputTokens : null,
      userInstruction: String(body.userInstruction ?? ''),
      titleHint: typeof body.titleHint === 'string' ? body.titleHint : null,
      subtitleHint: typeof body.subtitleHint === 'string' ? body.subtitleHint : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create continue block'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const result = await regenerateContinueBlock({
      continueBlockId: String(body.continueBlockId ?? ''),
      generatedText: String(body.generatedText ?? ''),
      userInstruction: String(body.userInstruction ?? ''),
      selectedText: String(body.selectedText ?? ''),
      originalText: String(body.originalText ?? ''),
      inputTokens: typeof body.inputTokens === 'number' ? body.inputTokens : null,
      outputTokens: typeof body.outputTokens === 'number' ? body.outputTokens : null,
      titleHint: typeof body.titleHint === 'string' ? body.titleHint : null,
      subtitleHint: typeof body.subtitleHint === 'string' ? body.subtitleHint : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate continue block'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
