import { ApiRequestError, assertJsonMediaType, noStoreJson, noStoreJsonError, readBoundedJsonObject } from '@/lib/server/api-route'
import {
  beginCustomLocalEmbeddingInstall,
  beginLocalEmbeddingInstall,
  beginLocalEmbeddingStart,
  getLocalEmbeddingRuntimeStatus,
  stopLocalEmbeddingRuntime,
} from '@/lib/server/local-embedding-runtime'
import { getLocalEmbeddingModel } from '@/lib/server/local-embedding-catalog'
import { normalizeHuggingFaceCustomModelReference } from '@/lib/server/local-embedding-custom-model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin')?.trim()
  if (!origin) return

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    throw new ApiRequestError(403, 'Request origin is invalid')
  }

  const requestUrl = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim()
  const host = forwardedHost || request.headers.get('host')?.trim() || requestUrl.host
  if (originUrl.origin !== requestUrl.origin && originUrl.host !== host) {
    throw new ApiRequestError(403, 'Cross-origin local embedding changes are not allowed')
  }
}

export async function GET() {
  return noStoreJson(await getLocalEmbeddingRuntimeStatus())
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    assertJsonMediaType(request)
    const body = await readBoundedJsonObject(request, 4_096, 'Local embedding request is too large')
    const action = typeof body.action === 'string' ? body.action.trim() : ''

    if (action === 'install') {
      const unexpectedField = Object.keys(body).find((key) => key !== 'action' && key !== 'modelId')
      if (unexpectedField) throw new ApiRequestError(400, `Unexpected field: ${unexpectedField}`)
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (!modelId) throw new ApiRequestError(400, 'modelId is required')
      if (!getLocalEmbeddingModel(modelId)) throw new ApiRequestError(400, 'Unknown local embedding model')
      return noStoreJson(await beginLocalEmbeddingInstall(modelId), { status: 202 })
    }
    if (action === 'install-custom') {
      const unexpectedField = Object.keys(body).find((key) => (
        key !== 'action'
        && key !== 'repository'
        && key !== 'fileName'
        && key !== 'riskAccepted'
        && key !== 'installConfirmed'
      ))
      if (unexpectedField) throw new ApiRequestError(400, `Unexpected field: ${unexpectedField}`)
      if (body.riskAccepted !== true) {
        throw new ApiRequestError(400, 'Custom model risk confirmation is required')
      }
      if (body.installConfirmed !== true) {
        throw new ApiRequestError(400, 'Custom model installation confirmation is required')
      }
      if (typeof body.repository !== 'string' || typeof body.fileName !== 'string') {
        throw new ApiRequestError(400, 'repository and fileName are required')
      }
      const reference = normalizeHuggingFaceCustomModelReference({
        repository: body.repository,
        fileName: body.fileName,
      })
      return noStoreJson(await beginCustomLocalEmbeddingInstall(reference), { status: 202 })
    }
    if (action === 'start') {
      const unexpectedField = Object.keys(body).find((key) => key !== 'action')
      if (unexpectedField) throw new ApiRequestError(400, `Unexpected field: ${unexpectedField}`)
      return noStoreJson(await beginLocalEmbeddingStart(), { status: 202 })
    }
    if (action === 'stop') {
      const unexpectedField = Object.keys(body).find((key) => key !== 'action')
      if (unexpectedField) throw new ApiRequestError(400, `Unexpected field: ${unexpectedField}`)
      return noStoreJson(await stopLocalEmbeddingRuntime())
    }

    throw new ApiRequestError(400, 'action must be install, install-custom, start, or stop')
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 400
    const message = error instanceof Error ? error.message : 'Local embedding request failed'
    return noStoreJsonError(message, status)
  }
}
