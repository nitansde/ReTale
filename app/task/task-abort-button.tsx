"use client"

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export function TaskAbortButton({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleAbort = () => {
    setErrorMessage(null)

    startTransition(async () => {
      try {
        const response = await fetch('/api/task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ jobId }),
        })

        const payload = (await response.json().catch(() => null)) as { error?: string } | null

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Failed to abort task')
        }

        router.refresh()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to abort task')
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-2 lg:min-w-56 lg:items-end">
      <button
        type="button"
        onClick={handleAbort}
        disabled={isPending}
        className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Aborting...' : 'Abort'}
      </button>

      {errorMessage ? <p className="text-xs text-rose-200">{errorMessage}</p> : null}
    </div>
  )
}
