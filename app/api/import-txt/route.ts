import { NextResponse } from 'next/server'
import { importNovelIntoWorkspace } from '@/lib/server/import-txt'
import { findWorkspaceState, upsertWorkspaceState } from '@/lib/server/persistence'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'

function looksLikeMojibake(text: string) {
  const badChars = (text.match(/[�]/g) || []).length
  const weirdChars = (text.match(/[\u0370-\u03FF\u0400-\u04FF]/g) || []).length
  return badChars > 20 || weirdChars > 40
}

async function decodeTextFile(file: File) {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  if (utf8.trim() && !looksLikeMojibake(utf8)) {
    return utf8
  }

  try {
    const gb = new TextDecoder('gb18030', { fatal: false }).decode(buffer)
    if (gb.trim()) return gb
  } catch {
    // ignore and fall back
  }

  return utf8
}

async function ensureWorkspacePayload() {
  const existing = findWorkspaceState('singleton')
  if (existing) {
    return normalizeWorkspaceState(JSON.parse(existing.payload))
  }

  return createEmptyWorkspaceState()
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 })
    }

    const text = await decodeTextFile(file)
    if (!text.trim()) {
      return NextResponse.json({ ok: false, error: 'Empty file' }, { status: 400 })
    }

    const currentState = await ensureWorkspacePayload()
    const nextState = importNovelIntoWorkspace(currentState, {
      title: file.name.replace(/\.[^.]+$/, ''),
      text,
      summary: `从 ${file.name} 导入`,
    })

    upsertWorkspaceState('singleton', JSON.stringify(nextState))

    void syncWorkspacePayloadToKnowledgeStore(nextState).catch((error) => {
      console.error('Import workspace sync failed:', error)
    })

    return NextResponse.json({
      ok: true,
      novelId: nextState.currentNovelId,
      chapterId: nextState.currentChapterId,
      chapterCount: nextState.localChapters.filter((item: { novelId: string; parentChapterId?: string }) => item.novelId === nextState.currentNovelId && !item.parentChapterId).length,
    })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
