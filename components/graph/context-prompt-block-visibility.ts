import type { GenerationContextPromptBlock } from '@/components/graph/types'

const HIDDEN_ADVANCED_CONTEXT_BLOCK_IDS = new Set(['output-constraints'])

export function getVisibleAdvancedContextPromptBlocks(blocks: GenerationContextPromptBlock[]) {
  return blocks.filter((block) => !HIDDEN_ADVANCED_CONTEXT_BLOCK_IDS.has(block.id))
}
