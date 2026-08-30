// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WritingSkillDistillationPanel } from '@/components/library/WritingSkillDistillationPanel'
import type { WritingSkillCardDetail, WritingSkillDistillationJob } from '@/lib/writing-skill-types'

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => values?.count !== undefined
      ? `${key}:${values.count}`
      : key,
  }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createCard(): WritingSkillCardDetail {
  return {
    id: 'card-1',
    libraryId: 'library-1',
    libraryVersion: 'version-1',
    libraryName: '测试素材库',
    title: '作者甲 · 五官描写',
    userInstruction: '五官',
    summary: '从素材证据中提炼出的五官描写方法。',
    applicationScope: '人物出场与情绪变化。',
    rules: [
      { text: '选择少量辨识度高的细节。', evidenceRefs: ['W01-C001-P001'] },
      { text: '让视线变化承接情绪。', evidenceRefs: ['W01-C002-P001'] },
      { text: '让环境光线参与刻画。', evidenceRefs: ['W01-C003-P001'] },
      { text: '按观察顺序递进信息。', evidenceRefs: ['W01-C004-P001'] },
    ],
    avoid: ['逐项罗列', '复制独特措辞'],
    defaultExampleCount: 5,
    modelConfigId: 'knowledgeExtraction',
    status: 'ACTIVE',
    sourceJobId: 'job-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    examples: Array.from({ length: 6 }, (_, index) => ({
      id: `example-${index + 1}`,
      skillCardId: 'card-1',
      rangeRef: {
        libraryId: 'library-1',
        libraryVersion: 'version-1',
        workId: 'work-1',
        chapterId: `chapter-${index + 1}`,
        startParagraphId: `paragraph-${index + 1}`,
        endParagraphId: `paragraph-${index + 1}`,
      },
      displayRef: `W01-C${String(index + 1).padStart(3, '0')}-P001`,
      score: 0.9,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      anonymizedText: `匿名化范文段落 ${index + 1}。`,
    })),
  }
}

describe('WritingSkillDistillationPanel', () => {
  it('creates a card from one natural-language direction and exposes only simple user controls', async () => {
    const card = createCard()
    const completedJob: WritingSkillDistillationJob = {
      id: 'job-1',
      libraryId: 'library-1',
      libraryVersion: 'version-1',
      userInstruction: '五官',
      modelConfigId: 'knowledgeExtraction',
      status: 'COMPLETED',
      message: '写作技巧卡已完成',
      randomSeed: 123,
      roundCount: 1,
      sampledRanges: [],
      candidateRefs: [],
      candidateCount: 8,
      inputTokens: 100,
      outputTokens: 50,
      errorMessage: null,
      resultCardId: card.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/material-libraries/library-1/writing-skills' && method === 'GET') {
        return jsonResponse({ ok: true, cards: [] })
      }
      if (url === '/api/material-libraries/library-1/writing-skills' && method === 'POST') {
        return jsonResponse({ ok: true, jobId: 'job-1' }, 202)
      }
      if (url === '/api/writing-skills/card-1/regenerate' && method === 'POST') {
        return jsonResponse({ ok: true, jobId: 'job-2' }, 202)
      }
      if (url === '/api/writing-skill-jobs/job-1' && method === 'GET') {
        return jsonResponse({ ok: true, job: completedJob })
      }
      if (url === '/api/writing-skill-jobs/job-2' && method === 'GET') {
        return jsonResponse({ ok: true, job: { ...completedJob, id: 'job-2' } })
      }
      if (url === '/api/writing-skills/card-1' && method === 'GET') {
        return jsonResponse({ ok: true, card })
      }
      if (url === '/api/writing-skills/card-1' && method === 'DELETE') {
        return jsonResponse({ ok: true })
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))

    render(
      <WritingSkillDistillationPanel
        open
        library={{ id: 'library-1', title: '测试素材库' }}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByPlaceholderText('writingSkill.placeholder')).toBeInTheDocument()
    expect(screen.getByLabelText('writingSkill.contextWindowLabel')).toHaveValue('256k')
    expect(screen.queryByRole('option', { name: 'writingSkill.contextWindowAuto' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('writingSkill.totalBudgetLabel')).toHaveValue('512k')
    expect(screen.queryByText(/关键词/)).not.toBeInTheDocument()
    expect(screen.queryByText(/相似度/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('writingSkill.placeholder'), { target: { value: '五官' } })
    fireEvent.change(screen.getByLabelText('writingSkill.contextWindowLabel'), { target: { value: '32k' } })
    fireEvent.change(screen.getByLabelText('writingSkill.totalBudgetLabel'), { target: { value: '1m' } })
    fireEvent.click(screen.getByRole('button', { name: /writingSkill.start/ }))

    await waitFor(() => expect(screen.getByDisplayValue('作者甲 · 五官描写')).toBeInTheDocument())
    const createCall = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === '/api/material-libraries/library-1/writing-skills' && init?.method === 'POST'
    ))
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      instruction: '五官',
      scanContextWindow: '32k',
      scanTotalBudget: '1m',
    })
    expect(screen.getByText('writingSkill.ruleCount:4')).toBeInTheDocument()
    expect(screen.getByText('writingSkill.avoidTitle')).toBeInTheDocument()
    expect(screen.getByText('逐项罗列')).toBeInTheDocument()
    expect(screen.getByText('复制独特措辞')).toBeInTheDocument()
    expect(screen.getByText('writingSkill.exampleCount:6')).toBeInTheDocument()
    expect(screen.getByText('匿名化范文段落 1。')).toBeInTheDocument()
    expect(screen.queryByText('W01-C001-P001')).not.toBeInTheDocument()
    expect(screen.getByText('writingSkill.regenerate')).toBeInTheDocument()
    expect(screen.getByText('writingSkill.refine')).toBeInTheDocument()
    expect(screen.queryByText('writingSkill.archive')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('writingSkill.advanced'))
    expect(screen.getByLabelText('writingSkill.defaultExampleCount')).toHaveValue('5')
    expect(screen.getByRole('option', { name: '10' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'writingSkill.regenerate' }))
    await waitFor(() => {
      const regenerateCall = fetchMock.mock.calls.find(([url, init]) => (
        String(url) === '/api/writing-skills/card-1/regenerate' && init?.method === 'POST'
      ))
      expect(JSON.parse(String(regenerateCall?.[1]?.body))).toEqual({
        resample: true,
        scanContextWindow: '32k',
        scanTotalBudget: '1m',
      })
    })
    await waitFor(() => expect(screen.getByDisplayValue('作者甲 · 五官描写')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'writingSkill.delete' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/writing-skills/card-1', { method: 'DELETE' }))
    expect(screen.getByText('writingSkill.noExisting')).toBeInTheDocument()
  })
})
