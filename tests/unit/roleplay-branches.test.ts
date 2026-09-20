import { describe, expect, it } from 'vitest'
import { buildRoleplayMessageTree, getRoleplayBranchTip, getRoleplayMessagePath } from '@/lib/roleplay-branches'

const message = (id: number, parent: number | null) => ({ id: String(id), parentMessageId: parent === null ? null : String(parent), messageIndex: id })

describe('roleplay branch navigation', () => {
  it('keeps nested routes ordered by their fork point when older routes are continued', () => {
    const tree = buildRoleplayMessageTree([message(1, null), message(2, 1), message(3, 2), message(4, 1), message(5, 3), message(6, 2)])
    expect(tree.leaves.map((item) => item.id)).toEqual(['5', '6', '4'])
    expect(getRoleplayMessagePath(tree.messagesById, '5').map((item) => item.id)).toEqual(['1', '2', '3', '5'])
    expect(getRoleplayBranchTip(tree.childrenByParentId, tree.messagesById.get('2'))?.id).toBe('6')
  })
  it('keeps independent roots and orphaned messages selectable', () => {
    const tree = buildRoleplayMessageTree([message(1, null), message(2, 1), message(3, 99), message(4, 3)])
    expect(tree.leaves.map((item) => item.id)).toEqual(['2', '4'])
    expect(getRoleplayMessagePath(tree.messagesById, '4').map((item) => item.id)).toEqual(['3', '4'])
  })
  it('handles empty data and stops on cyclic legacy links', () => {
    expect(buildRoleplayMessageTree([]).leaves).toEqual([])
    const tree = buildRoleplayMessageTree([message(1, 2), message(2, 1)])
    expect(getRoleplayMessagePath(tree.messagesById, '2')).toHaveLength(2)
    expect(getRoleplayBranchTip(tree.childrenByParentId, tree.messagesById.get('1'))?.id).toBe('2')
  })
})
