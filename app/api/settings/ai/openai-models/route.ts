import { NextResponse } from 'next/server'
import { apiRequestErrorResponse, jsonError, readJsonObject } from '@/lib/server/api-route'
import type { AIScenarioKey } from '@/lib/types'
import { listAvailableOpenAICompatibleModels } from '@/lib/server/openai-compatible'

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request) as {
      baseUrl?: unknown
      apiKey?: unknown
      scenario?: AIScenarioKey
    }

    if ((body.baseUrl !== undefined && typeof body.baseUrl !== 'string') || (body.apiKey !== undefined && typeof body.apiKey !== 'string')) {
      return jsonError('baseUrl and apiKey must be strings', 400)
    }
    const scenario = body.scenario === undefined || body.scenario === 'rewrite' || body.scenario === 'knowledgeExtraction' || body.scenario === 'embeddings'
      ? (body.scenario ?? 'rewrite')
      : null
    if (!scenario) {
      return jsonError('scenario is invalid', 400)
    }
    const result = await listAvailableOpenAICompatibleModels(body.baseUrl as string | undefined, body.apiKey as string | undefined, scenario, request.signal)

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    return jsonError(error instanceof Error ? error.message : 'Failed to list OpenAI-compatible models', 500)
  }
}
