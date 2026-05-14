import { NextResponse } from 'next/server'
import type { AIScenarioKey } from '@/lib/types'
import { listAvailableOpenAICompatibleModels } from '@/lib/server/openai-compatible'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      baseUrl?: string
      apiKey?: string
      scenario?: AIScenarioKey
    }

    const scenario = body.scenario === 'knowledgeExtraction' || body.scenario === 'embeddings' || body.scenario === 'rewrite'
      ? body.scenario
      : 'rewrite'
    const result = await listAvailableOpenAICompatibleModels(body.baseUrl, body.apiKey, scenario)

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
