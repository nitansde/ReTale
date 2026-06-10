import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { listActiveBackgroundTasks } from '@/lib/server/background-tasks'
import { readActiveWorkspaceNovelId } from '@/lib/server/persistence'
import { TaskPageClient } from './task-page-client'

export const runtime = 'nodejs'

export default async function TaskPage() {
  const activeNovelId = readActiveWorkspaceNovelId()
  const tasks = activeNovelId
    ? await listActiveBackgroundTasks({ novelId: activeNovelId, db: createNovelDatabaseAccess(activeNovelId) })
    : []

  return <TaskPageClient tasks={tasks} />
}
