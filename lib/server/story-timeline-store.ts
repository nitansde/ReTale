import { execute, queryAll, queryOne } from '@/lib/server/sqlite'
import { countChineseFriendlyWords } from '@/lib/utils'
import type {
  ChapterTimelineItem,
  StoryTimelineBranchNode,
  StoryTimelineEdge,
  StoryTimelineNodeRecord,
  StoryTimelineNodeType,
  StoryTimelineResponse,
} from '@/lib/story-branch-types'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
}

const defaultDb: Db = { execute, queryAll, queryOne }

type StoryTimelineNodeRow = {
  id: string
  novel_id: string
  branch_id: string
  node_type: StoryTimelineNodeType
  label_index: number
  anchor_chapter_no: number
  title: string
  subtitle: string | null
  parent_node_id: string | null
  source_chapter_no: number | null
  target_chapter_no: number | null
  chapter_id: string | null
  continue_block_id: string | null
  what_if_session_id: string | null
  future_jump_run_id: string | null
  continue_block_latest_text: string | null
  continue_block_latest_revision_no: number | null
  continue_block_user_instruction: string | null
  continue_block_selected_text: string | null
  continue_block_original_text: string | null
  lane_index: number | null
  color_token: string | null
  status: string
  created_at: string
  updated_at: string
}

const STORY_TIMELINE_NODE_SELECT = `
  SELECT
    story_timeline_nodes.*,
    continue_blocks.latest_text AS continue_block_latest_text,
    continue_blocks.latest_revision_no AS continue_block_latest_revision_no,
    continue_blocks.user_instruction AS continue_block_user_instruction,
    continue_blocks.selected_text AS continue_block_selected_text,
    continue_blocks.original_text AS continue_block_original_text
  FROM story_timeline_nodes
  LEFT JOIN continue_blocks ON continue_blocks.id = story_timeline_nodes.continue_block_id
`

type KnowledgeChapterRow = {
  id: string
  chapterNo: number
  title: string | null
  rawText: string | null
}

function toStoryTimelineNodeRecord(row: StoryTimelineNodeRow): StoryTimelineNodeRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    nodeType: row.node_type,
    labelIndex: row.label_index,
    anchorChapterNo: row.anchor_chapter_no,
    title: row.title,
    subtitle: row.subtitle,
    parentNodeId: row.parent_node_id,
    sourceChapterNo: row.source_chapter_no,
    targetChapterNo: row.target_chapter_no,
    chapterId: row.chapter_id,
    continueBlockId: row.continue_block_id,
    whatIfSessionId: row.what_if_session_id,
    futureJumpRunId: row.future_jump_run_id,
    latestText: row.continue_block_latest_text,
    latestRevisionNo: row.continue_block_latest_revision_no,
    userInstruction: row.continue_block_user_instruction,
    selectedText: row.continue_block_selected_text,
    originalText: row.continue_block_original_text,
    laneIndex: row.lane_index ?? 0,
    colorToken: row.color_token,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getNextStoryTimelineLabelIndex(novelId: string, branchId: string, nodeType: StoryTimelineNodeType, db: Db = defaultDb) {
  const row = db.queryOne<{ next_index: number }>(
    `SELECT COALESCE(MAX(label_index), 0) + 1 AS next_index
     FROM story_timeline_nodes
     WHERE novel_id = ? AND branch_id = ? AND node_type = ?`,
    novelId,
    branchId,
    nodeType
  )

  return row?.next_index ?? 1
}

export function createStoryTimelineNode(input: Omit<StoryTimelineNodeRecord, 'createdAt' | 'updatedAt'>, db: Db = defaultDb) {
  db.execute(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.novelId,
    input.branchId,
    input.nodeType,
    input.labelIndex,
    input.anchorChapterNo,
    input.title,
    input.subtitle,
    input.parentNodeId,
    input.sourceChapterNo,
    input.targetChapterNo,
    input.chapterId,
    input.continueBlockId,
    input.whatIfSessionId,
    input.futureJumpRunId,
    input.laneIndex,
    input.colorToken,
    input.status
  )

  return findStoryTimelineNodeById(input.id, db)
}

export function findStoryTimelineNodeById(id: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(`${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.id = ?`, id)
  return row ? toStoryTimelineNodeRecord(row) : null
}

export function findStoryTimelineNodeByFutureJumpRunId(futureJumpRunId: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.future_jump_run_id = ? LIMIT 1`,
    futureJumpRunId
  )
  return row ? toStoryTimelineNodeRecord(row) : null
}

export function findStoryTimelineNodeByContinueBlockId(continueBlockId: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.continue_block_id = ? LIMIT 1`,
    continueBlockId
  )
  return row ? toStoryTimelineNodeRecord(row) : null
}

export function findStoryTimelineNodeByWhatIfSessionId(whatIfSessionId: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.what_if_session_id = ? LIMIT 1`,
    whatIfSessionId
  )
  return row ? toStoryTimelineNodeRecord(row) : null
}

export function listStoryTimelineNodesByFutureJumpRunIds(futureJumpRunIds: string[], db: Db = defaultDb) {
  if (!futureJumpRunIds.length) return []

  const placeholders = futureJumpRunIds.map(() => '?').join(', ')
  const rows = db.queryAll<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT}
     WHERE story_timeline_nodes.future_jump_run_id IN (${placeholders})
     ORDER BY story_timeline_nodes.anchor_chapter_no ASC, story_timeline_nodes.lane_index ASC, story_timeline_nodes.label_index ASC`,
    ...futureJumpRunIds
  )

  return rows.map(toStoryTimelineNodeRecord)
}

export function listStoryTimelineNodes(novelId: string, branchId: string, db: Db = defaultDb) {
  const rows = db.queryAll<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT}
     WHERE story_timeline_nodes.novel_id = ? AND story_timeline_nodes.branch_id = ?
     ORDER BY story_timeline_nodes.anchor_chapter_no ASC, story_timeline_nodes.lane_index ASC, story_timeline_nodes.label_index ASC`,
    novelId,
    branchId
  )

  return rows.map(toStoryTimelineNodeRecord)
}

export function listStoryTimelineDescendantNodeIds(rootNodeId: string, nodes: StoryTimelineNodeRecord[]) {
  const childrenByParentId = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentNodeId) continue
    const current = childrenByParentId.get(node.parentNodeId) ?? []
    current.push(node.id)
    childrenByParentId.set(node.parentNodeId, current)
  }

  const ordered: string[] = []
  const visited = new Set<string>()

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    for (const childId of childrenByParentId.get(nodeId) ?? []) {
      visit(childId)
    }

    ordered.push(nodeId)
  }

  visit(rootNodeId)
  return ordered
}

export function deleteStoryTimelineNodesByIds(nodeIds: string[], db: Db = defaultDb) {
  for (const nodeId of nodeIds) {
    const row = db.queryOne<{ continue_block_id: string | null }>(
      'SELECT continue_block_id FROM story_timeline_nodes WHERE id = ?',
      nodeId
    )
    if (row?.continue_block_id) {
      db.execute('DELETE FROM continue_blocks WHERE id = ?', row.continue_block_id)
    }
    db.execute('DELETE FROM story_timeline_nodes WHERE id = ?', nodeId)
  }
}

export function updateStoryTimelineNodeStatus(id: string, status: string, db: Db = defaultDb) {
  db.execute('UPDATE story_timeline_nodes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', status, id)
  return findStoryTimelineNodeById(id, db)
}

export function updateStoryTimelineNodePresentation(
  id: string,
  input: { title: string; subtitle: string | null; status: string },
  db: Db = defaultDb
) {
  db.execute(
    'UPDATE story_timeline_nodes SET title = ?, subtitle = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    input.title,
    input.subtitle,
    input.status,
    id
  )
  return findStoryTimelineNodeById(id, db)
}

function loadTimelineChapters(novelId: string, branchId: string, db: Db): ChapterTimelineItem[] {
  const rows = db.queryAll<KnowledgeChapterRow>(
    `SELECT id, chapterNo, title, rawText
     FROM KnowledgeChapter
     WHERE novelId = ? AND branchId = ?
     ORDER BY chapterNo ASC, id ASC`,
    novelId,
    branchId
  )

  return rows.map((row) => ({
    type: 'chapter',
    chapterNo: row.chapterNo,
    chapterId: row.id,
    title: row.title?.trim() || `第 ${row.chapterNo} 章`,
    wordCount: countChineseFriendlyWords(row.rawText ?? ''),
  }))
}

function toStoryTimelineBranchNode(node: StoryTimelineNodeRecord): StoryTimelineBranchNode {
  return {
    type: 'branch_node',
    id: node.id,
    nodeType: node.nodeType,
    anchorChapterNo: node.anchorChapterNo,
    parentNodeId: node.parentNodeId,
    title: node.title,
    subtitle: node.subtitle,
    laneIndex: node.laneIndex,
    colorToken: node.colorToken,
    sourceChapterNo: node.sourceChapterNo,
    targetChapterNo: node.targetChapterNo,
    continueBlockId: node.continueBlockId,
    whatIfSessionId: node.whatIfSessionId,
    futureJumpRunId: node.futureJumpRunId,
    latestText: node.latestText ?? null,
    latestRevisionNo: node.latestRevisionNo ?? null,
    userInstruction: node.userInstruction ?? null,
    selectedText: node.selectedText ?? null,
    originalText: node.originalText ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    status: node.status,
  }
}

function compareStoryTimelineNodeChronology(left: StoryTimelineNodeRecord, right: StoryTimelineNodeRecord): number {
  if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt)
  return left.id.localeCompare(right.id)
}

function resolveStoryTimelineNodeDepth(
  node: StoryTimelineNodeRecord,
  nodesById: Map<string, StoryTimelineNodeRecord>,
  visited = new Set<string>()
): number {
  if (!node.parentNodeId) return 0
  if (visited.has(node.id)) return 0

  const parentNode = nodesById.get(node.parentNodeId)
  if (!parentNode) return 0

  visited.add(node.id)
  return resolveStoryTimelineNodeDepth(parentNode, nodesById, visited) + 1
}

function orderStoryTimelineNodes(nodes: StoryTimelineNodeRecord[]): StoryTimelineNodeRecord[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const childrenByParentId = new Map<string, StoryTimelineNodeRecord[]>()
  const rootNodes: StoryTimelineNodeRecord[] = []

  for (const node of nodes) {
    if (node.parentNodeId && nodesById.has(node.parentNodeId)) {
      const current = childrenByParentId.get(node.parentNodeId) ?? []
      current.push(node)
      childrenByParentId.set(node.parentNodeId, current)
      continue
    }

    rootNodes.push(node)
  }

  for (const children of childrenByParentId.values()) {
    children.sort(compareStoryTimelineNodeChronology)
  }

  rootNodes.sort((left, right) => {
    if (left.anchorChapterNo !== right.anchorChapterNo) return left.anchorChapterNo - right.anchorChapterNo
    return compareStoryTimelineNodeChronology(left, right)
  })

  const nodeDepths = new Map(nodes.map((node) => [node.id, resolveStoryTimelineNodeDepth(node, nodesById)]))
  const ordered: StoryTimelineNodeRecord[] = []
  const visit = (node: StoryTimelineNodeRecord) => {
    ordered.push({ ...node, laneIndex: nodeDepths.get(node.id) ?? node.laneIndex })
    for (const child of childrenByParentId.get(node.id) ?? []) {
      visit(child)
    }
  }

  for (const rootNode of rootNodes) {
    visit(rootNode)
  }

  return ordered
}

function buildTimelineEdges(nodes: StoryTimelineNodeRecord[]): StoryTimelineEdge[] {
  return nodes
    .filter((node) => node.parentNodeId)
    .map((node) => ({
      fromNodeId: node.parentNodeId!,
      toNodeId: node.id,
    }))
}

export function loadStoryTimeline(novelId: string, branchId: string, db: Db = defaultDb): StoryTimelineResponse {
  const chapters = loadTimelineChapters(novelId, branchId, db)
  const nodes = orderStoryTimelineNodes(listStoryTimelineNodes(novelId, branchId, db))

  return {
    novelId,
    branchId,
    chapters,
    branchNodes: nodes.map(toStoryTimelineBranchNode),
    edges: buildTimelineEdges(nodes),
  }
}
