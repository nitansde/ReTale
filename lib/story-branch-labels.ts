import type { StoryTimelineNodeType } from '@/lib/story-branch-types'

type StoryBranchLabelNode = {
  id: string
  nodeType: StoryTimelineNodeType
  labelIndex: number
  parentNodeId: string | null
}

type StoryBranchDisplayNode = {
  readableLabel?: string | null
  readableLineageLabel?: string | null
  title?: string | null
}

const STORY_BRANCH_LABEL_PREFIXES = {
  rewrite: 'RE',
  continue_block: 'CONT',
  what_if: 'IF',
  future_jump: 'JUMP',
} as const satisfies Record<StoryTimelineNodeType, string>

export function formatStoryBranchReadableLabel(nodeType: StoryTimelineNodeType, labelIndex: number) {
  return `${STORY_BRANCH_LABEL_PREFIXES[nodeType]}-${String(labelIndex).padStart(2, '0')}`
}

export function buildStoryBranchReadableLineageLabel(
  node: StoryBranchLabelNode,
  nodesById: ReadonlyMap<string, StoryBranchLabelNode>
) {
  const segments: string[] = []
  const visited = new Set<string>()

  let current: StoryBranchLabelNode | undefined = node
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    segments.unshift(formatStoryBranchReadableLabel(current.nodeType, current.labelIndex))
    current = current.parentNodeId ? nodesById.get(current.parentNodeId) : undefined
  }

  return segments.join(', ')
}

export function prefixStoryBranchTitle(readableLineageLabel: string, suffix: string) {
  const trimmedSuffix = suffix.trim()
  return trimmedSuffix ? `${readableLineageLabel} ${trimmedSuffix}` : readableLineageLabel
}

export function resolveStoryBranchDisplayLabel(node: StoryBranchDisplayNode) {
  const readableLabel = node.readableLabel?.trim()
  if (readableLabel) return readableLabel

  const readableLineageLabel = node.readableLineageLabel?.trim()
  if (readableLineageLabel) return readableLineageLabel

  return node.title?.trim() ?? ''
}

export function formatStoryBranchInstructionPreview(value: string | null | undefined, maxChars = 15) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized) return ''

  const characters = Array.from(normalized)
  return characters.length > maxChars ? `${characters.slice(0, maxChars).join('')}…` : characters.join('')
}
