type MessageLink = { id: string; parentMessageId: string | null; messageIndex: number }

export function buildRoleplayMessageTree<T extends MessageLink>(messages: T[]) {
  const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex)
  const messagesById = new Map(ordered.map((message) => [message.id, message]))
  const childrenByParentId = new Map<string | null, T[]>()
  for (const message of ordered) {
    const parentId = message.parentMessageId && messagesById.has(message.parentMessageId) ? message.parentMessageId : null
    const children = childrenByParentId.get(parentId) ?? []
    children.push(message)
    childrenByParentId.set(parentId, children)
  }
  // Tree order keeps a route in the same place when it receives more messages.
  const leaves: T[] = []
  const visited = new Set<string>()
  const pending = [...(childrenByParentId.get(null) ?? [])].reverse()
  while (pending.length) {
    const message = pending.pop()!
    if (visited.has(message.id)) continue
    visited.add(message.id)
    const children = childrenByParentId.get(message.id) ?? []
    if (!children.length) leaves.push(message)
    else pending.push(...[...children].reverse())
  }
  return { messagesById, childrenByParentId, leaves }
}

export function getRoleplayMessagePath<T extends MessageLink>(messagesById: Map<string, T>, messageId: string | null | undefined) {
  const chain: T[] = []
  const visited = new Set<string>()
  let cursor = messageId
  while (cursor && !visited.has(cursor)) {
    const message = messagesById.get(cursor)
    if (!message) break
    chain.push(message)
    visited.add(cursor)
    cursor = message.parentMessageId
  }
  return chain.reverse()
}

export function getRoleplayBranchTip<T extends MessageLink>(childrenByParentId: Map<string | null, T[]>, message: T | undefined): T | undefined {
  const visited = new Set<string>()
  while (message && !visited.has(message.id)) {
    visited.add(message.id)
    const child = childrenByParentId.get(message.id)?.at(-1)
    if (!child || visited.has(child.id)) break
    message = child
  }
  return message
}
