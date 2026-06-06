import { NextResponse } from 'next/server'
import { importNovelIntoWorkspace } from '@/lib/server/import-txt'
import { upsertWorkspaceState } from '@/lib/server/persistence'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import {
  backfillWorkspaceRuntimeFromArtifactIfMissing,
  loadWorkspacePayloadFromRuntimeOrRecovery,
  persistWorkspaceRuntimeState,
} from '@/lib/server/workspace-resilience'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return Number.POSITIVE_INFINITY

  const replacementChars = countMatches(text, /�/g)
  const privateUseChars = countMatches(text, /[\uE000-\uF8FF]/g)
  const suspiciousLatinChars = countMatches(text, /[ÃÂÄÅÆ]/g)
  const suspiciousCjkMojibakeChars = countMatches(text, /[鏈鐨銆锛紝鍦涓鏄]/g)
  const euroChars = countMatches(text, /€/g)
  const greekOrCyrillicChars = countMatches(text, /[\u0370-\u03FF\u0400-\u04FF]/g)

  return replacementChars * 40
    + privateUseChars * 16
    + euroChars * 8
    + greekOrCyrillicChars * 8
    + suspiciousLatinChars * 6
    + suspiciousCjkMojibakeChars * 4
}

async function decodeTextFile(file: File) {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const candidates = [{ text: utf8, score: scoreDecodedText(utf8) }]

  try {
    const gb = new TextDecoder('gb18030', { fatal: false }).decode(buffer)
    candidates.push({ text: gb, score: scoreDecodedText(gb) })
  } catch {
  }

  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]?.text ?? utf8
}

async function ensureWorkspacePayload() {
  backfillWorkspaceRuntimeFromArtifactIfMissing('singleton')
  return loadWorkspacePayloadFromRuntimeOrRecovery('singleton')
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
    const nextState = normalizeWorkspaceState(importNovelIntoWorkspace(currentState, {
      title: file.name.replace(/\.[^.]+$/, ''),
      text,
      summary: `从 ${file.name} 导入`,
    }))

    persistWorkspaceRuntimeState(nextState)
    upsertWorkspaceState('singleton', JSON.stringify(nextState), { backupReason: 'import-txt' })
    await syncWorkspacePayloadToKnowledgeStore(nextState)

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
