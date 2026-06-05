import { NextResponse } from 'next/server'
import { abortBackgroundTask, listActiveBackgroundTasks } from '@/lib/server/background-tasks'

export const runtime = 'nodejs'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function GET() {
  try {
    const tasks = listActiveBackgroundTasks()
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

    if (!jobId) {
      return NextResponse.json({ ok: false, error: 'jobId is required' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const result = abortBackgroundTask(jobId)
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
