import Link from 'next/link'
import { listActiveBackgroundTasks } from '@/lib/server/background-tasks'
import { TaskAbortButton } from './task-abort-button'

export const runtime = 'nodejs'

type BackgroundTask = Awaited<ReturnType<typeof listActiveBackgroundTasks>>[number]

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
}

const JOB_TYPE_LABELS: Record<string, string> = {
  extract_chapter_knowledge: 'Knowledge rebuild',
  rebuild_retrieval_index: 'Retrieval rebuild',
  rewrite_generation: 'Recoverable rewrite generation',
}

function formatJobType(jobType: string) {
  return JOB_TYPE_LABELS[jobType] ?? jobType.replace(/_/g, ' ')
}

function formatStatus(status: string) {
  return STATUS_LABELS[status] ?? status
}

function formatUpdatedAt(value: string | Date | null | undefined) {
  if (!value) return 'Unknown'

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatProgress(progress: number | null | undefined) {
  if (typeof progress !== 'number' || Number.isNaN(progress)) {
    return 'Unknown'
  }

  const normalized = progress <= 1 ? progress * 100 : progress
  const clamped = Math.max(0, Math.min(100, normalized))

  return `${Math.round(clamped)}%`
}

function getStatusClasses(status: string) {
  switch (status) {
    case 'running':
      return 'border-indigo-400/30 bg-indigo-500/12 text-indigo-100'
    case 'paused':
      return 'border-amber-300/30 bg-amber-500/12 text-amber-100'
    case 'queued':
      return 'border-violet-400/30 bg-violet-500/12 text-violet-100'
    default:
      return 'border-white/10 bg-white/[0.04] text-zinc-200'
  }
}

function renderNovelLine(task: BackgroundTask) {
  if (task.novelTitle?.trim()) {
    return task.novelId ? `${task.novelTitle} (${task.novelId})` : task.novelTitle
  }

  if (task.novelId) {
    return task.novelId
  }

  return 'Not attached'
}

function renderBranchLine(task: BackgroundTask) {
  return task.branchId ?? 'Default branch'
}

function TaskMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-200">{value}</dd>
    </div>
  )
}

export default async function TaskPage() {
  const tasks = await listActiveBackgroundTasks()
  const sortedTasks = [...tasks].sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime()
    const rightTime = new Date(right.updatedAt).getTime()

    return rightTime - leftTime
  })

  return (
    <main className="min-h-screen bg-[#0a0c12] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">Persisted backend task monitor</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Tasks</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Active tasks include queued, running, and paused persisted jobs. This page reads directly from the
              server task source.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300">
            <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">JSON endpoint</div>
            <Link className="mt-1 inline-block text-indigo-200 transition hover:text-indigo-100" href="/api/task">
              /api/task
            </Link>
          </div>
        </header>

        <section className="mb-6 rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.16),_transparent_38%),rgba(255,255,255,0.04)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Active tasks</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-white">{sortedTasks.length}</p>
            </div>
            <p className="max-w-xl text-sm leading-6 text-zinc-400">
              Use this page for a quick backend view, or open the JSON endpoint for raw task payloads.
            </p>
          </div>
        </section>

        {sortedTasks.length === 0 ? (
          <section className="rounded-[28px] border border-dashed border-white/10 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.08),_transparent_36%),#0b0d12] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="mx-auto max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">All quiet</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">No active tasks</h2>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                There are currently no queued, running, or paused persisted backend jobs.
              </p>
            </div>
          </section>
        ) : (
          <div className="space-y-4">
            {sortedTasks.map((task) => (
              <article
                key={task.jobId}
                className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${getStatusClasses(task.status)}`}>
                        {formatStatus(task.status)}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                        {formatJobType(task.jobType)}
                      </span>
                    </div>

                    <h2 className="mt-4 text-lg font-semibold tracking-tight text-white">{task.jobId}</h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      {task.currentStep?.trim() || 'No current step reported yet.'}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 lg:items-end">
                    <TaskAbortButton jobId={task.jobId} />

                    <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300 lg:min-w-56">
                      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                        <span>Progress</span>
                        <span>{formatProgress(task.progress)}</span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,rgba(129,140,248,0.9),rgba(168,85,247,0.95))]"
                          style={{
                            width:
                              typeof task.progress === 'number'
                                ? `${Math.max(0, Math.min(100, task.progress <= 1 ? task.progress * 100 : task.progress))}%`
                                : '0%',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <TaskMetaRow label="Novel" value={renderNovelLine(task)} />
                  <TaskMetaRow label="Branch" value={renderBranchLine(task)} />
                  <TaskMetaRow label="Updated" value={formatUpdatedAt(task.updatedAt)} />
                  <TaskMetaRow label="Created" value={formatUpdatedAt(task.createdAt)} />
                  <TaskMetaRow label="Status" value={formatStatus(task.status)} />
                  <TaskMetaRow label="Job type" value={formatJobType(task.jobType)} />
                </dl>

                {task.errorMessage?.trim() ? (
                  <div className="mt-4 rounded-[20px] border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-amber-200/80">Task note</div>
                    <p className="mt-1 leading-6">{task.errorMessage}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
