// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskPageClient } from '@/app/task/task-page-client'
import { I18nProvider, useI18n } from '@/lib/i18n/provider'
import { progressMessage } from '@/lib/i18n/progress-message'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/browser-preferences', () => ({ readBrowserWorkspaceSession: () => ({ currentNovelId: 'novel-progress' }) }))

function SwitchLocale() {
  const { setLocale } = useI18n()
  return <button onClick={() => setLocale('zh')}>Switch locale</button>
}

afterEach(() => { vi.unstubAllGlobals() })

describe('task progress translation', () => {
  it('translates persisted progress keys and switches locale without fetching again', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: [
      { jobId: 'new', novelId: 'novel-progress', status: 'running', jobType: 'extract_chapter_knowledge', currentStep: progressMessage('progress.extractChapter', { chapter: 7 }) },
      { jobId: 'migrated', novelId: 'novel-progress', status: 'queued', jobType: 'rebuild_retrieval_index', currentStep: progressMessage('progress.rawEmbeddingWait') },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<I18nProvider initialLocale="en" localeCookiePresent><SwitchLocale /><TaskPageClient /></I18nProvider>)
    expect(await screen.findByText('Extracting candidate knowledge (chapter 7 completed)')).toBeInTheDocument()
    expect(screen.getByText('Waiting for source-text embeddings')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('@retale-progress:')
    fireEvent.click(screen.getByRole('button', { name: 'Switch locale' }))
    expect(screen.getByText('并行抽取候选知识（已完成第 7 章）')).toBeInTheDocument()
    expect(screen.getByText('等待原文 Embedding 预计算完成')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
