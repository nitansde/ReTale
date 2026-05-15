import { createHash } from 'node:crypto'
import { execute, queryOne, withTransaction } from '@/lib/server/sqlite'
import { uid } from '@/lib/utils'

export const MAIN_BRANCH_NAME = 'main'

export function getMainBranchId(novelId: string) {
  return `${novelId}:main`
}

export function normalizeBranchId(novelId: string, branchId?: string | null) {
  const normalized = branchId?.trim()
  if (!normalized) {
    return getMainBranchId(novelId)
  }

  return normalized.includes(':') ? normalized : `${novelId}:${normalized}`
}

export type LineRecordInput = {
  lineNo: number
  text: string
  charStart: number | null
  charEnd: number | null
}

export type TextSpanInput = {
  id: string
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  lineStart: number
  lineEnd: number
  charStart?: number | null
  charEnd?: number | null
  text: string
  spanType: string
  tokenEstimate?: number | null
}

export type EvidenceSearchResult = {
  spanId: string
  chapterNo: number
  score: number
}

export function hashContent(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.replace(/\s+/g, '').length / 1.6))
}

export function splitChapterLines(text: string): LineRecordInput[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const rawLines = normalized.split('\n')
  const lines: LineRecordInput[] = []
  let cursor = 0

  rawLines.forEach((raw, index) => {
    const start = cursor
    const end = cursor + raw.length
    lines.push({
      lineNo: index + 1,
      text: raw,
      charStart: start,
      charEnd: end,
    })
    cursor = end + 1
  })

  return lines
}

export function buildTextSpansFromLines(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  text: string
  lines: LineRecordInput[]
}): TextSpanInput[] {
  const { novelId, branchId, chapterId, chapterNo, text, lines } = params
  const spans: TextSpanInput[] = []
  const paragraphBuffer: Array<{ line: LineRecordInput; offsetStart: number; offsetEnd: number }> = []

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return
    const first = paragraphBuffer[0]
    const last = paragraphBuffer[paragraphBuffer.length - 1]
    const paragraphText = paragraphBuffer.map((item) => item.line.text).join('\n').trim()
    if (!paragraphText) {
      paragraphBuffer.length = 0
      return
    }

    spans.push({
      id: uid('span-paragraph'),
      novelId,
      branchId,
      chapterId,
      chapterNo,
      lineStart: first.line.lineNo,
      lineEnd: last.line.lineNo,
      charStart: first.offsetStart,
      charEnd: last.offsetEnd,
      text: paragraphText,
      spanType: 'paragraph',
      tokenEstimate: estimateTokenCount(paragraphText),
    })

    paragraphBuffer.length = 0
  }

  let runningOffset = 0
  for (const line of lines) {
    const clean = line.text.trim()
    const start = runningOffset
    const end = runningOffset + line.text.length

    if (clean) {
      paragraphBuffer.push({ line, offsetStart: start, offsetEnd: end })

      spans.push({
        id: uid('span-evidence'),
        novelId,
        branchId,
        chapterId,
        chapterNo,
        lineStart: line.lineNo,
        lineEnd: line.lineNo,
        charStart: start,
        charEnd: end,
        text: clean,
        spanType: 'evidence',
        tokenEstimate: estimateTokenCount(clean),
      })
    } else {
      flushParagraph()
    }

    runningOffset = end + 1
  }
  flushParagraph()

  const paragraphSpans = spans.filter((item) => item.spanType === 'paragraph')
  for (let index = 0; index < paragraphSpans.length; index += 2) {
    const sceneParts = paragraphSpans.slice(index, index + 2)
    if (!sceneParts.length) continue
    spans.push({
      id: uid('span-scene'),
      novelId,
      branchId,
      chapterId,
      chapterNo,
      lineStart: sceneParts[0].lineStart,
      lineEnd: sceneParts[sceneParts.length - 1].lineEnd,
      charStart: sceneParts[0].charStart ?? null,
      charEnd: sceneParts[sceneParts.length - 1].charEnd ?? null,
      text: sceneParts.map((item) => item.text).join('\n\n'),
      spanType: 'scene',
      tokenEstimate: estimateTokenCount(sceneParts.map((item) => item.text).join('\n\n')),
    })
  }

  const summaryText = text.trim().split(/\n+/).slice(0, 8).join('\n').trim()
  if (summaryText) {
    spans.push({
      id: uid('span-summary'),
      novelId,
      branchId,
      chapterId,
      chapterNo,
      lineStart: lines[0]?.lineNo ?? 1,
      lineEnd: lines[Math.max(0, lines.length - 1)]?.lineNo ?? 1,
      charStart: 0,
      charEnd: text.length,
      text: summaryText,
      spanType: 'summary',
      tokenEstimate: estimateTokenCount(summaryText),
    })
  }

  return spans
}

export async function ensureMainBranch(novelId: string) {
  const branchId = getMainBranchId(novelId)
  execute(
    `
      INSERT INTO StoryBranch (id, novelId, name)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        novelId = excluded.novelId,
        name = excluded.name,
        updatedAt = CURRENT_TIMESTAMP
    `,
    branchId,
    novelId,
    MAIN_BRANCH_NAME
  )

  return queryOne<{ id: string; novelId: string; name: string }>(
    'SELECT id, novelId, name FROM StoryBranch WHERE id = ?',
    branchId
  )
}

export function findStoryBranch(id: string) {
  return queryOne<{ id: string; novelId: string; name: string }>(
    'SELECT id, novelId, name FROM StoryBranch WHERE id = ?',
    id
  )
}

export async function enqueueKnowledgeJob(params: {
  novelId: string
  branchId?: string | null
  jobType: string
  payload?: unknown
  currentStep?: string
}) {
  const id = uid('job')
  execute(
    `
      INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, payloadJson)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `,
    id,
    params.novelId,
    params.branchId ?? null,
    params.jobType,
    params.currentStep ?? null,
    params.payload ? JSON.stringify(params.payload) : null
  )

  return queryOne<{ id: string; novelId: string; branchId: string | null; jobType: string }>(
    'SELECT id, novelId, branchId, jobType FROM KnowledgeJob WHERE id = ?',
    id
  )
}

export async function markKnowledgeStaleFromChapter(params: {
  novelId: string
  branchId: string
  fromChapterNo: number
}) {
  await withTransaction(async () => {
    execute(
      `
        UPDATE KnowledgeChapter
        SET isDirty = 1,
            knowledgeStatus = 'stale',
            dirtyReason = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ? AND chapterNo >= ?
      `,
      `Chapter ${params.fromChapterNo} changed`,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    execute(
      `
        UPDATE KnowledgeFact
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND validUntilChapter > ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    execute(
      `
        UPDATE KnowledgeRelation
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND validUntilChapter > ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    execute(
      `
        UPDATE EntityLink
        SET status = 'potentially_stale', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND validUntilChapter > ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    execute(
      `
        UPDATE EntityState
        SET status = 'potentially_stale', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND validUntilChapter > ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    execute(
      `
        UPDATE KnowledgeEvent
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ? AND chapterNo >= ? AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    execute(
      `
        UPDATE EventLink
        SET status = 'potentially_stale', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND (validFromChapter >= ? OR sourceChapter >= ?)
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo,
      params.fromChapterNo
    )

    execute(
      `
        UPDATE KnowledgeWorld
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND validUntilChapter > ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

  })

  const { deleteBranchRetrievalIndexFromChapter } = await import('@/lib/server/retrieval-index')
  await deleteBranchRetrievalIndexFromChapter(params.branchId, params.fromChapterNo)

}
