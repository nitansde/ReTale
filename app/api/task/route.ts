import { NextResponse } from 'next/server'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { abortBackgroundTask, listActiveBackgroundTasks } from '@/lib/server/background-tasks'
import { readActiveWorkspaceNovelId } from '@/lib/server/persistence'

export const runtime = 'nodejs'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function GET() {
  try {
    const novelId = readActiveWorkspaceNovelId()
    if (!novelId) {
      return NextResponse.json({ ok: true, count: 0, tasks: [] }, { headers: NO_STORE_HEADERS })
    }

    const tasks = listActiveBackgroundTasks({ novelId, db: createNovelDatabaseAccess(novelId) })
    return NextResponse.json(
      {
        ok: true,
        count: tasks.length,
        tasks,
      },
      {
        headers: NO_STORE_HEADERS,
      }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load background tasks' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown
    const jobId = body && typeof body === 'object' && !Array.isArray(body)
      ? typeof (body as { jobId?: unknown }).jobId === 'string'
        ? (body as { jobId: string }).jobId.trim()
        : ''
      : ''
    const novelId = body && typeof body === 'object' && !Array.isArray(body)
      ? typeof (body as { novelId?: unknown }).novelId === 'string'
        ? (body as { novelId: string }).novelId.trim()
        : readActiveWorkspaceNovelId()
      : readActiveWorkspaceNovelId()

    if (!jobId) {
      return NextResponse.json({ ok: false, error: 'jobId is required' }, { status: 400, headers: NO_STORE_HEADERS })
    }
    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const result = abortBackgroundTask({ jobId, novelId, db: createNovelDatabaseAccess(novelId) })
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.statusCode, headers: NO_STORE_HEADERS })
    }

    return NextResponse.json(result, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to abort background task' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
