import { NextResponse } from 'next/server'
import { listAvailableOpenAICompatibleModels } from '@/lib/server/openai-compatible'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      baseUrl?: string
      apiKey?: string
    }

    const result = await listAvailableOpenAICompatibleModels(body.baseUrl, body.apiKey)

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list OpenAI-compatible models',
      },
      { status: 500 }
    )
  }
}
