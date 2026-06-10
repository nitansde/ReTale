import { NextResponse } from 'next/server'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { findStoryBranch, normalizeBranchId } from '@/lib/server/knowledge-store'
import { loadFutureMapSourceData } from '@/lib/server/outline-bootstrap'
import { findWhatIfSessionById } from '@/lib/server/what-if-store'

function parsePositiveSourceChapterNo(value: string | null) {
  const sourceChapterNo = Number(value)
  if (!Number.isInteger(sourceChapterNo) || sourceChapterNo < 1) {
    return null
  }
  return sourceChapterNo
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const rawBranchId = searchParams.get('branchId')?.trim() ?? ''
    const parentSessionId = searchParams.get('parentSessionId')?.trim() || searchParams.get('whatIfSessionId')?.trim() || ''

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!rawBranchId) {
      return NextResponse.json({ ok: false, error: 'branchId is required' }, { status: 400 })
    }

    const branchId = normalizeBranchId(novelId, rawBranchId)
    const db = createNovelDatabaseAccess(novelId)
    const branch = findStoryBranch(branchId, db)
    if (!branch || branch.novelId !== novelId) {
      return NextResponse.json({ ok: false, error: 'branchId does not belong to the requested novel' }, { status: 404 })
    }

    const sourceChapterNo = parsePositiveSourceChapterNo(searchParams.get('sourceChapterNo'))
    if (!sourceChapterNo) {
      return NextResponse.json({ ok: false, error: 'sourceChapterNo must be a positive integer' }, { status: 400 })
    }

    const sourceChapterId = searchParams.get('sourceChapterId')?.trim() ?? ''
    if (sourceChapterId) {
      const sourceChapter = db.queryOne<{ id: string; chapterNo: number }>(
        `SELECT id, chapterNo
           FROM KnowledgeChapter
          WHERE id = ? AND novelId = ? AND branchId = ?
          LIMIT 1`,
        sourceChapterId,
        novelId,
        branchId,
      )
      if (!sourceChapter) {
        return NextResponse.json({ ok: false, error: 'sourceChapterId not found for the requested branch context' }, { status: 404 })
      }
      if (sourceChapter.chapterNo !== sourceChapterNo) {
        return NextResponse.json({ ok: false, error: 'sourceChapterId must match sourceChapterNo' }, { status: 400 })
      }
    }

    if (parentSessionId) {
      const session = findWhatIfSessionById(parentSessionId, db)
      if (!session || session.novelId !== novelId || session.baseBranchId !== branchId) {
        return NextResponse.json({ ok: false, error: 'parentSessionId not found for the requested branch context' }, { status: 404 })
      }
    }

    const payload = await loadFutureMapSourceData({
      novelId,
      branchId,
      db,
    })

    const chaptersByEvent = Object.fromEntries(
      Object.entries(payload.chaptersByEvent)
        .map(([eventId, chapters]) => [eventId, chapters.filter((chapter) => chapter.chapterNo > sourceChapterNo)])
        .filter(([, chapters]) => chapters.length > 0)
    )

    const events = payload.events.filter((event) => chaptersByEvent[event.id]?.length)
    const tracks = Array.from(
      events.reduce((map, event) => {
        const current = map.get(event.trackKey)
        const sourceTypes = current?.sourceTypes ?? new Set<string>()
        sourceTypes.add(event.sourceType)
        map.set(event.trackKey, {
          trackKey: event.trackKey,
          phaseLabel: current?.phaseLabel ?? event.phaseLabel,
          eventCount: (current?.eventCount ?? 0) + 1,
          sourceTypes,
        })
        return map
      }, new Map<string, { trackKey: string; phaseLabel: string | null; eventCount: number; sourceTypes: Set<string> }>()).values()
    ).map((track) => ({
      trackKey: track.trackKey,
      phaseLabel: track.phaseLabel,
      eventCount: track.eventCount,
      sourceTypes: Array.from(track.sourceTypes).sort((left, right) => left.localeCompare(right, 'en-US')),
    }))

    const defaults = {
      selectedTrackKey: events[0]?.trackKey ?? null,
      selectedOutlineNodeId: events[0]?.id ?? null,
    }

    return NextResponse.json({
      ...payload,
      tracks,
      events,
      chaptersByEvent,
      defaults,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load story future map' },
      { status: 500 }
    )
  }
}
