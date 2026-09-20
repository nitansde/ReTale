import { describe, expect, it } from 'vitest'
import { buildRoleplayMessageTree, getRoleplayBranchDeletionIds, getRoleplayBranchTip, getRoleplayMessagePath } from '@/lib/roleplay-branches'

const message = (id: number, parent: number | null) => ({ id: String(id), parentMessageId: parent === null ? null : String(parent), messageIndex: id })

describe('roleplay branch navigation', () => {
  it('deletes only the unique suffix of nested routes and rejects non-leaf targets', () => {
    const messages = [message(1, null), message(2, 1), message(3, 2), message(4, 3), message(5, 3), message(6, 2), message(7, 6)]
    expect(getRoleplayBranchDeletionIds(messages, '4')).toEqual(['4'])
    expect(getRoleplayBranchDeletionIds(messages, '7')).toEqual(['7', '6'])
    expect(getRoleplayBranchDeletionIds(messages, '3')).toEqual([])
    expect(getRoleplayBranchDeletionIds(messages, 'missing')).toEqual([])
    expect(getRoleplayBranchDeletionIds(messages.slice(0, 4), '4')).toEqual(['4', '3', '2', '1'])
    expect(getRoleplayBranchDeletionIds([message(1, null), message(2, null)], '2')).toEqual(['2'])
  })
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
