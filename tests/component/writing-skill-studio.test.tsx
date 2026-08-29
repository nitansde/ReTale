// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WritingSkillStudio } from '@/components/writing-skills/WritingSkillStudio'
import type { WritingSkillCardDetail, WritingSkillDistillationJob } from '@/lib/writing-skill-types'

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => values
      ? `${key}:${Object.values(values).join(':')}`
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
    libraryId: 'writing-skill-collection:abc',
    libraryVersion: 'version-1',
    libraryName: '书库作品、独立素材',
    title: '多书 · 环境描写',
    userInstruction: '环境描写',
    summary: '从多部原文素材中提炼出的环境描写组织方法，强调空间、感官和人物行动之间的关联。',
    applicationScope: '适用于人物进入新空间、氛围转折和场景过渡。',
    rules: Array.from({ length: 4 }, (_, index) => ({
      text: `写作方法 ${index + 1}`,
      evidenceRefs: [`W01-C00${index + 1}-P001`],
    })),
    avoid: ['避免堆砌形容词', '避免环境与行动脱节'],
    defaultExampleCount: 3,
    modelConfigId: 'knowledgeExtraction',
    status: 'ACTIVE',
    sourceJobId: 'job-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    sources: [
      { sourceType: 'LIBRARY', sourceId: 'library-1', sourceVersion: 'v1', sourceName: '书库作品', sourceOrder: 0 },
      { sourceType: 'UPLOAD', sourceId: 'upload-1', sourceVersion: 'v2', sourceName: '独立素材', sourceOrder: 1 },
    ],
    examples: Array.from({ length: 6 }, (_, index) => ({
      id: `example-${index + 1}`,
      skillCardId: 'card-1',
      rangeRef: {
        libraryId: 'writing-skill-collection:abc',
        libraryVersion: 'version-1',
        workId: index < 3 ? 'library:library-1' : 'upload:upload-1',
        chapterId: `chapter-${index + 1}`,
        startParagraphId: `paragraph-${index + 1}`,
        endParagraphId: `paragraph-${index + 1}`,
      },
      displayRef: `${index < 3 ? 'W01' : 'W02'}-C001-P00${index + 1}`,
      score: 0.9,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      anonymizedText: `范文原文段落 ${index + 1}。`,
    })),
  }
}

describe('WritingSkillStudio', () => {
  it('selects library and upload-only books together and creates one global skill card', async () => {
    const card = createCard()
    const completedJob: WritingSkillDistillationJob = {
      id: 'job-1',
      libraryId: card.libraryId,
      libraryVersion: card.libraryVersion,
      userInstruction: '环境描写',
      modelConfigId: 'knowledgeExtraction',
      status: 'COMPLETED',
      message: '写作技巧卡已完成',
      randomSeed: 123,
      roundCount: 3,
      sampledRanges: [],
      candidateRefs: [],
      candidateCount: 24,
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
      if (url === '/api/writing-skill-sources' && method === 'GET') {
        return jsonResponse({
          ok: true,
          librarySources: [{
            sourceType: 'LIBRARY', sourceId: 'library-1', title: '书库作品', author: null,
            chapterCount: 10, estimatedTokens: 80_000, createdAt: null, updatedAt: null,
          }],
          uploadedSources: [{
            sourceType: 'UPLOAD', sourceId: 'upload-1', title: '独立素材', author: null,
            chapterCount: 8, estimatedTokens: 60_000, createdAt: null, updatedAt: null,
          }],
        })
      }
      if (url === '/api/writing-skills' && method === 'GET') return jsonResponse({ ok: true, cards: [] })
      if (url === '/api/writing-skills' && method === 'POST') return jsonResponse({ ok: true, jobId: 'job-1' }, 202)
      if (url === '/api/writing-skill-jobs/job-1' && method === 'GET') return jsonResponse({ ok: true, job: completedJob })
      if (url === '/api/writing-skills/card-1' && method === 'GET') return jsonResponse({ ok: true, card })
      throw new Error(`Unexpected request: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WritingSkillStudio />)

    expect(await screen.findByText('writingSkill.pageTitle')).toBeInTheDocument()
    fireEvent.click(screen.getByText('书库作品'))
    fireEvent.click(screen.getByText('独立素材'))
    fireEvent.change(screen.getByPlaceholderText('writingSkill.placeholder'), { target: { value: '环境描写' } })
    fireEvent.change(screen.getByLabelText('writingSkill.contextWindowLabel'), { target: { value: '64k' } })
    fireEvent.change(screen.getByLabelText('writingSkill.totalBudgetLabel'), { target: { value: '1m' } })
    fireEvent.click(screen.getByRole('button', { name: 'writingSkill.start' }))

    await waitFor(() => expect(screen.getByDisplayValue('多书 · 环境描写')).toBeInTheDocument())
    const createCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/writing-skills' && init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      instruction: '环境描写',
      sourceRefs: [
        { sourceType: 'LIBRARY', sourceId: 'library-1' },
        { sourceType: 'UPLOAD', sourceId: 'upload-1' },
      ],
      scanContextWindow: '64k',
      scanTotalBudget: '1m',
    })
    expect(screen.getByText('书库作品')).toBeInTheDocument()
    expect(screen.getByText('独立素材')).toBeInTheDocument()
    expect(screen.getByText('范文原文段落 1。')).toBeInTheDocument()
  })
})
