"use client"

import { ArrowRight, LoaderCircle, RefreshCcw } from 'lucide-react'

export function FutureJumpControlPanel(props: {
  feedback: string
  onFeedbackChange: (value: string) => void
  onRegenerate: () => void
  regenerating: boolean
  onContinue: () => void
  continueDisabled: boolean
  latestRevisionNo: number
  actionError: string
}) {
  return (
    <section className="rounded-[24px] border border-sky-400/20 bg-sky-500/10 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">Revision controls</p>
          <h3 className="mt-2 text-lg font-semibold text-zinc-100">在最新 Future 版本上继续试错</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">这里保持单一 combined revise 流：一段反馈 + 一次重生成，不拆分 bridge-only / text-only 控件。</p>
        </div>
        <span className="rounded-full border border-sky-300/20 bg-black/20 px-3 py-1 text-[11px] text-sky-100">当前 latest revision: {props.latestRevisionNo}</span>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-sm text-zinc-300">Revision feedback</span>
        <textarea
          value={props.feedback}
          onChange={(event) => props.onFeedbackChange(event.target.value)}
          className="min-h-[140px] w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
          placeholder="例如：保留这版未来走向，但把误会升级得更慢，让情绪后果更长尾。"
          data-testid="future-jump-feedback"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={props.onRegenerate}
          disabled={props.regenerating}
          className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="future-jump-regenerate"
        >
          {props.regenerating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Regenerate Future Jump
        </button>
        <button
          type="button"
          onClick={props.onContinue}
          disabled={props.continueDisabled}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowRight className="h-4 w-4" />
          Continue this Future
        </button>
      </div>

      <div className="mt-4 rounded-[18px] border border-amber-300/18 bg-amber-500/10 p-3 text-xs leading-6 text-amber-100">
        继续改写会复用现有 rewrite overlay，但默认只把最新 Future 输出当作候选和 source material，不直接回写主线章节正文。
      </div>

      {props.actionError ? (
        <div data-testid="future-jump-action-error" className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-500/10 p-3 text-sm leading-6 text-rose-100">
          {props.actionError}
        </div>
      ) : null}
    </section>
  )
}
