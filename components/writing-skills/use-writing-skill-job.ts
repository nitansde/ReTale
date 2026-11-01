"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/provider'
import type { WritingSkillCardDetail, WritingSkillDistillationJob } from '@/lib/writing-skill-types'

export type WritingSkillJobState =
  | { kind: 'idle' }
  | { kind: 'running'; job: WritingSkillDistillationJob }
  | { kind: 'result'; card: WritingSkillCardDetail }
  | { kind: 'error'; message: string }

const TERMINAL_JOB_STATUSES = new Set(['COMPLETED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'CANCELLED'])

export function useWritingSkillJob(options: {
  loadCards: () => Promise<void>
  pendingJob: Pick<WritingSkillDistillationJob, 'libraryId' | 'modelConfigId' | 'userInstruction'>
}) {
  const { loadCards, pendingJob } = options
  const { t } = useI18n()
  const [jobState, setJobState] = useState<WritingSkillJobState>({ kind: 'idle' })
  const pollingJobIdRef = useRef<string | null>(null)

  // Stop polling only on unmount: `t` changes on a locale switch and must not
  // silently abandon a running job.
  useEffect(() => () => { pollingJobIdRef.current = null }, [])

  const loadCardDetail = useCallback(async (cardId: string) => {
    const response = await fetch(`/api/writing-skills/${encodeURIComponent(cardId)}`, { cache: 'no-store' })
    const data = await response.json() as { ok?: boolean; card?: WritingSkillCardDetail; error?: string }
    if (!response.ok || !data.ok || !data.card) throw new Error(data.error || t('writingSkill.loadFailed'))
    return data.card
  }, [t])

  const pollJob = async (jobId: string) => {
    pollingJobIdRef.current = jobId
    while (pollingJobIdRef.current === jobId) {
      const response = await fetch(`/api/writing-skill-jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      const data = await response.json() as { ok?: boolean; job?: WritingSkillDistillationJob; error?: string }
      if (!response.ok || !data.ok || !data.job) throw new Error(data.error || t('writingSkill.jobFailed'))
      const job = data.job
      if (pollingJobIdRef.current !== jobId) return
      setJobState({ kind: 'running', job })
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        pollingJobIdRef.current = null
        if (job.status === 'COMPLETED' && job.resultCardId) {
          const card = await loadCardDetail(job.resultCardId)
          setJobState({ kind: 'result', card })
          await loadCards()
          return
        }
        if (job.status === 'CANCELLED') {
          setJobState({ kind: 'idle' })
          return
        }
        setJobState({ kind: 'error', message: job.errorMessage || job.message || t('writingSkill.jobFailed') })
        return
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 900))
    }
  }

  const startJob = async (url: string, body: Record<string, unknown> = {}) => {
    try {
      setJobState({
        kind: 'running',
        job: {
          ...pendingJob,
          id: 'pending',
          libraryVersion: null,
          status: 'PENDING',
          message: t('writingSkill.starting'),
          randomSeed: 0,
          roundCount: 0,
          sampledRanges: [],
          candidateRefs: [],
          candidateCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          errorMessage: null,
          resultCardId: null,
          createdAt: '',
          updatedAt: '',
        },
      })
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json() as { ok?: boolean; jobId?: string; error?: string }
      if (!response.ok || !data.ok || !data.jobId) throw new Error(data.error || t('writingSkill.jobFailed'))
      await pollJob(data.jobId)
    } catch (error) {
      pollingJobIdRef.current = null
      setJobState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.jobFailed') })
    }
  }

  const cancelJob = async () => {
    const jobId = jobState.kind === 'running' ? jobState.job.id : null
    if (!jobId || jobId === 'pending') return
    pollingJobIdRef.current = null
    await fetch(`/api/writing-skill-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => undefined)
    setJobState({ kind: 'idle' })
  }

  return { jobState, setJobState, loadCardDetail, startJob, cancelJob }
}
