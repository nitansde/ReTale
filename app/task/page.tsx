import { listActiveBackgroundTasks } from '@/lib/server/background-tasks'
import { TaskPageClient } from './task-page-client'

export const runtime = 'nodejs'

export default async function TaskPage() {
  const tasks = await listActiveBackgroundTasks()

  return <TaskPageClient tasks={tasks} />
}
