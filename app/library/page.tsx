import { ProjectGrid } from '@/components/library/project-grid'

export default function LibraryPage() {
  return (
    <main className="min-h-screen bg-[#0a0c12] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">Selection-first novel studio</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">书库</h1>
            <p className="mt-2 text-sm text-zinc-400">进入小说后，核心流程就是：选章节、选正文、直接从浮动操作气泡触发魔改 / 角色扮演 / 智能扩写。</p>
          </div>
        </div>

        <ProjectGrid />
      </div>
    </main>
  )
}
