// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceKnowledgeControls } from '@/components/workspace/WorkspaceKnowledgeControls'
import { resolveRetrievalTaskControlsState } from '@/components/workspace/selection-novel-studio-helpers'

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'zh',
    t: (key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ''}`,
  }),
}))

type Props = ComponentProps<typeof WorkspaceKnowledgeControls>

const fullCoverage = {
  status: 'full' as const,
  coveredChapterCount: 64,
  totalChapterCount: 64,
  validThroughChapterNo: 64,
}

function buildProps(overrides: Partial<Props> = {}): Props {
  const knowledgeStatusOverview = {
    knowledgeGraph: fullCoverage,
    extractionCache: fullCoverage,
    embeddingCache: {
      ...fullCoverage,
      provider: 'ollama',
      model: 'qwen3-embedding:4b',
    },
    retrievalIndex: { status: 'full' as const, indexedScopeCount: 64, task: null },
  }
  const noop = () => undefined

  return {
    knowledgeRebuilding: false,
    knowledgeRebuildActive: false,
    knowledgeActionLoading: null,
    knowledgeRebuildPaused: false,
    knowledgeRebuildFailed: false,
    knowledgeRebuildRangeMode: 'all',
    knowledgeRebuildFirstChapterCount: '5',
    knowledgeRebuildStartChapter: '1',
    knowledgeRebuildEndChapter: '5',
    selectedKnowledgeRebuildChapterRangeLabel: '全部章节',
    knowledgeStatusOverview,
    currentKnowledgeJobBusy: false,
    knowledgeGraphOverview: knowledgeStatusOverview.knowledgeGraph,
    extractionCacheOverview: knowledgeStatusOverview.extractionCache,
    embeddingCacheOverview: knowledgeStatusOverview.embeddingCache,
    retrievalIndexOverview: knowledgeStatusOverview.retrievalIndex,
    retrievalIndexStatusLine: 'LanceDB 已覆盖全部章节。',
    retrievalTaskStatus: null,
    retrievalTaskStatusLabel: '已完成',
    retrievalTaskPhaseLabel: null,
    retrievalControlsState: resolveRetrievalTaskControlsState({
      retrievalTask: null,
      retrievalIndexOverview: knowledgeStatusOverview.retrievalIndex,
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    }),
    mainKnowledgeRebuildStatus: null,
    knowledgeRebuildFailureMessage: null,
    knowledgeRebuildEtaMinutes: null,
    hanlpBootstrapStatusLine: 'HanLP 缓存就绪。',
    hanlpBootstrapCompletedChapterCount: null,
    hanlpBootstrapTotalChapterCount: null,
    hanlpCacheStatusLabel: '缓存就绪',
    hanlpBootstrapCacheHitRatePercent: null,
    hanlpBootstrapPhaseLabel: '',
    hanlpBootstrapEtaLabel: '',
    hanlpBootstrapTimingLabel: null,
    hanlpSettingsLine: null,
    rawTextEmbeddingStatusLine: '原文 Embedding 缓存已覆盖全部 64 章。',
    rawTextEmbeddingActive: false,
    rawTextEmbeddingPhaseBadge: '已完成',
    rawTextEmbeddingCacheHitRatePercent: null,
    rawTextEmbeddingTimingLabel: null,
    rawTextEmbeddingSettingsLine: 'Ollama · qwen3-embedding:4b',
    knowledgeRebuildSteps: [],
    currentKnowledgeRunningStepKey: null,
    confirmDeleteHanlpCache: false,
    confirmDeleteExtractionCache: false,
    confirmDeleteEmbeddingCache: false,
    confirmDeleteKnowledge: false,
    hanlpCacheDeleteState: { disabled: false, helperText: '可删除' },
    extractionCacheDeleteState: { disabled: false, helperText: '可删除' },
    embeddingCacheDeleteState: { disabled: false, helperText: '可删除' },
    onRebuildKnowledge: noop,
    onPauseKnowledge: noop,
    onAbortKnowledge: noop,
    onRebuildRetrievalIndex: noop,
    onSetKnowledgeRebuildRangeMode: noop,
    onSetKnowledgeRebuildFirstChapterCount: noop,
    onSetKnowledgeRebuildStartChapter: noop,
    onSetKnowledgeRebuildEndChapter: noop,
    onToggleConfirmDeleteHanlpCache: noop,
    onToggleConfirmDeleteExtractionCache: noop,
    onToggleConfirmDeleteEmbeddingCache: noop,
    onToggleConfirmDeleteKnowledge: noop,
    onCancelDeleteHanlpCache: noop,
    onCancelDeleteExtractionCache: noop,
    onCancelDeleteEmbeddingCache: noop,
    onCancelDeleteKnowledge: noop,
    onDeleteHanlpCache: noop,
    onDeleteExtractionCache: noop,
    onDeleteEmbeddingCache: noop,
    onDeleteKnowledgeGraph: noop,
    ...overrides,
  }
}

describe('WorkspaceKnowledgeControls durable cache cards', () => {
  beforeEach(() => {
    document.documentElement.dataset.locale = 'zh'
  })

  it('shows the compact user summary first and keeps diagnostics collapsed', () => {
    render(<WorkspaceKnowledgeControls {...buildProps()} />)

    const summary = screen.getByTestId('workspace-knowledge-status')
    expect(summary).toHaveTextContent('workspace.knowledge.status.storyAnalysis')
    expect(summary).toHaveTextContent('workspace.knowledge.status.contentSearch')
    expect(screen.queryByTestId('workspace-knowledge-advanced-details')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-extraction-cache-card')).not.toBeInTheDocument()
    expect(summary).not.toHaveTextContent(/HanLP|LLM|Embedding|LanceDB|%/i)
  })

  it('shows full idle extraction and embedding coverage without idle progress', () => {
    render(<WorkspaceKnowledgeControls {...buildProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))

    const extractionCard = screen.getByTestId('workspace-extraction-cache-card')
    const embeddingCard = screen.getByTestId('workspace-embedding-cache-card')

    expect(extractionCard).toHaveTextContent('64 章')
    expect(extractionCard).toHaveTextContent('已完成')
    expect(embeddingCard).toHaveTextContent('64 章')
    expect(embeddingCard).not.toHaveTextContent('100%')
    expect(embeddingCard).toHaveTextContent('Ollama · qwen3-embedding:4b')
    expect(embeddingCard).not.toHaveTextContent('batch')
    expect(embeddingCard).not.toHaveTextContent('缓存命中率')
    expect(embeddingCard).not.toHaveTextContent('阶段耗时')
    expect(embeddingCard).not.toHaveTextContent('等待进度')
    expect(embeddingCard).not.toHaveTextContent('暂未返回')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows active telemetry in preference to durable embedding coverage', () => {
    render(<WorkspaceKnowledgeControls {...buildProps({
      rawTextEmbeddingActive: true,
      rawTextEmbeddingStatusLine: '与章节抽取并行进行，优先预热原文向量缓存。',
      rawTextEmbeddingPhaseBadge: '与抽取并行',
      rawTextEmbeddingCacheHitRatePercent: 20,
      rawTextEmbeddingTimingLabel: '12 秒',
      rawTextEmbeddingSettingsLine: 'Ollama · qwen3-embedding:4b · batch 32',
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))

    const embeddingCard = screen.getByTestId('workspace-embedding-cache-card')
    expect(embeddingCard).toHaveTextContent('20%')
    expect(embeddingCard).toHaveTextContent('12 秒')
    expect(embeddingCard).toHaveTextContent('batch 32')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('renders missing coverage immediately after a delete response replaces the overview', () => {
    const missingCoverage = {
      status: 'missing' as const,
      coveredChapterCount: 0,
      totalChapterCount: 64,
      validThroughChapterNo: null,
    }
    const { rerender } = render(<WorkspaceKnowledgeControls {...buildProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))

    const missingOverview = {
      ...buildProps().knowledgeStatusOverview!,
      extractionCache: missingCoverage,
      embeddingCache: { ...missingCoverage, provider: null, model: null },
    }
    rerender(<WorkspaceKnowledgeControls {...buildProps({
      knowledgeStatusOverview: missingOverview,
      extractionCacheOverview: missingOverview.extractionCache,
      embeddingCacheOverview: missingOverview.embeddingCache,
      rawTextEmbeddingStatusLine: '原文 Embedding 缓存尚未建立（0 / 64 章）。',
      rawTextEmbeddingPhaseBadge: '缺失',
      rawTextEmbeddingSettingsLine: null,
    })} />)

    expect(screen.getByTestId('workspace-extraction-cache-card')).toHaveTextContent('0 / 64 章')
    expect(screen.getByTestId('workspace-extraction-cache-card')).toHaveTextContent('缺失')
    expect(screen.getByTestId('workspace-embedding-cache-card')).toHaveTextContent('0 / 64 章')
    expect(screen.getByTestId('workspace-embedding-cache-card')).toHaveTextContent('缺失')
  })

  it('keeps raw failure diagnostics out of the primary summary', () => {
    const failedStatus = {
      jobId: 'job-1',
      novelId: 'novel-1',
      jobType: 'extract_chapter_knowledge' as const,
      status: 'failed',
      errorMessage: 'provider stack trace',
      progress: 0.4,
      currentStep: 'raw backend phase',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      etaMinutes: null,
      steps: [],
    }
    render(<WorkspaceKnowledgeControls {...buildProps({
      knowledgeRebuildFailed: true,
      mainKnowledgeRebuildStatus: failedStatus,
      knowledgeRebuildFailureMessage: 'provider stack trace',
    })} />)

    const summary = screen.getByTestId('workspace-knowledge-status')
    expect(summary).toHaveTextContent('workspace.knowledge.status.overall.ready')
    expect(summary).toHaveTextContent('workspace.knowledge.status.operation.failed')
    expect(summary).toHaveTextContent('workspace.knowledge.status.previousResultsAvailable')
    expect(summary).not.toHaveTextContent('provider stack trace')

    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))
    expect(screen.getByTestId('workspace-knowledge-advanced-details')).toHaveTextContent('provider stack trace')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('renders one primary phase progressbar and no advanced progressbars for active work', () => {
    const runningStatus = {
      jobId: 'job-1',
      novelId: 'novel-1',
      jobType: 'extract_chapter_knowledge' as const,
      status: 'running',
      progress: 0.95,
      currentStep: 'global phase',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      etaMinutes: 2,
      steps: [
        { key: 'extract' as const, label: 'Extract', status: 'running' as const, progress: 0.41, etaMinutes: 2, detail: 'Technical extraction detail' },
        { key: 'write' as const, label: 'Write', status: 'pending' as const, progress: 0, etaMinutes: null, detail: null },
      ],
    }
    render(<WorkspaceKnowledgeControls {...buildProps({
      knowledgeRebuildActive: true,
      currentKnowledgeJobBusy: true,
      mainKnowledgeRebuildStatus: runningStatus,
      knowledgeRebuildSteps: runningStatus.steps,
      currentKnowledgeRunningStepKey: 'extract',
    })} />)

    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveAttribute('aria-valuenow', '41')
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(screen.getByTestId('workspace-knowledge-status')).not.toHaveTextContent('Technical extraction detail')

    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(screen.getByTestId('workspace-knowledge-advanced-details')).toHaveTextContent('Technical extraction detail')
    expect(screen.getByTestId('workspace-knowledge-advanced-details')).toHaveTextContent('workspace.knowledge.status.maintenanceEyebrow')
  })

  it('labels a queued main rebuild consistently in advanced details without a progressbar', () => {
    const queuedStatus = {
      jobId: 'job-queued',
      novelId: 'novel-1',
      jobType: 'extract_chapter_knowledge' as const,
      status: 'queued',
      progress: 0.63,
      currentStep: 'Waiting for worker',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      etaMinutes: null,
      steps: [],
    }
    render(<WorkspaceKnowledgeControls {...buildProps({ mainKnowledgeRebuildStatus: queuedStatus })} />)

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))
    const advanced = screen.getByTestId('workspace-knowledge-advanced-details')
    expect(advanced).toHaveTextContent('workspace.knowledge.main.queued')
    expect(advanced).toHaveTextContent('workspace.knowledge.job.queued')
    expect(advanced).not.toHaveTextContent('workspace.knowledge.main.running')
    expect(advanced).not.toHaveTextContent('workspace.knowledge.calculating')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('redacts sensitive diagnostics at every advanced display boundary while preserving benign context', () => {
    const sensitive = [
      'Retry provider request through /api/knowledge-view',
      'Benign mixed URL https://host?note=hello%20world/docs&next=%2Fapi/knowledge-view',
      'Benign delimiter URL https://host?time=12:%30%30&next=/api/knowledge-view&ratio=0/64',
      'Benign standalone encoding note=hello%20world/docs next=%2Fapi%2Fknowledge-view ratio=0%2F64',
      'path=%2FUsers%2Falice%2Fcomponent-global-posix.json',
      'file=C%3A%5CUsers\\Alice\\component-global-windows.txt',
      'x=file%3A%2F%2F%2FUsers%2Falice%2Fcomponent-global-file.db',
      '?%2FUsers/alice/component-global-question.json',
      '#C%3A%5CUsers%5CAlice%5Ccomponent-global-fragment.txt',
      '&file%3A%2F%2F%2FUsers/alice/component-global-ampersand.db',
      'API Key: component-unquoted-spaced-secret',
      'Client Key = component-unquoted-client-secret',
      'connect.sid=component-unquoted-connect-secret',
      'session.connect.sid=component-prefixed-connect-secret',
      'session.id=component-session-id-secret',
      'Path lists: /Users/alice/component-first.json,/workspace/private/component-second.json',
      'Windows lists: C:\\Users\\Alice\\component-first.txt;D:\\Private\\component-second.txt',
      'UNC lists: \\\\server\\share\\component-first.txt,\\\\backup\\private\\component-second.txt',
      'https://host?/Users/alice/component-query-bare.txt',
      'https://host#/Users/alice/component-fragment-bare.txt',
      'https://host?path=%2FUsers%2Falice%2Fcomponent-encoded-query.json',
      'https://host#file=C%3A%5CUsers%5CAlice%5Ccomponent-encoded-fragment.txt',
      'https://host?path=%2FUsers/alice/component-mixed-query.json',
      'https://host#file=C%3A%5CUsers\\Alice\\component-mixed-fragment.txt',
      'https://host#x=C:%5CUsers%5CAlice%5Ccomponent-stale-drive.txt',
      'https://host?x=file%3A%2F%2F%2FUsers%2Falice%2Fcomponent-stale-file.db',
      'https://host?ok=1&/Users/alice/component-stale-ampersand.txt',
      '{"Authorization":"Basic json-basic-secret"}',
      '{"Authorization":["Basic array-first-secret","Bearer array-second-secret"]}',
      '[["Authorization","Basic tuple-first-secret, Bearer tuple-second-secret"]]',
      '"Authorization" => "Basic arrow-component-secret"',
      '{"token":["token-array-first","token-array-second"]}',
      '{"client_secret":{"primary":"object-first-secret","fallback":"object-second-secret"}}',
      '{"Cookie":["session=cookie-array-first","refresh=cookie-array-second"]}',
      'Set-Cookie: session=set-cookie-first, refresh=set-cookie-second',
      'Authorization: "Basic quoted-basic-secret"',
      'AWS_SECRET_ACCESS_KEY=aws-secret-material',
      'client_secret="client-secret-material"',
      '{"X-API-Key":"component-x-api-secret"}',
      '{"X-Client-Key":"component-x-client-secret"}',
      'Proxy-Authorization: Bearer component-proxy-secret',
      '{"API Key":"component-spaced-key-secret"}',
      '{"connect.sid":"component-connect-session-secret"}',
      'headers["Authorization"] = "component-bracket-secret"',
      'passwd=component-passwd-secret',
      '{"passphrase":["component-passphrase-first","component-passphrase-second"]}',
      '{\\"apiKey\\":\\"component-escaped-json-secret\\"}',
      'Set-Cookie: session=set-cookie-secret; Path=/; HttpOnly',
      'Cookie: session=cookie-secret',
      'private_key="quoted-private-key-material"',
      '-----BEGIN PRIVATE KEY-----',
      'pem-private-key-material',
      '-----END PRIVATE KEY-----',
      'Paths: /root/config.json /app/runtime.log /workspace/project.log /mnt/data.log C:\\Users\\Alice\\secret.txt \\\\fileserver\\private-share\\secret.txt',
      'Cannot load "/usr/local/My App/private config.json"',
      'Cannot load "C:\\Program Files\\Retale\\private config.json"',
      'Cannot load "\\\\fileserver\\Shared Folder\\private config.json"',
      'Cannot load //fileserver/Shared Folder/component-network-secret.json',
      'Cannot load "file:///Library/Application Support/Retale/private config.json"',
      'Cannot load `/data/Private Folder/config.json`',
      'Cannot load `C:\\Program Files\\Retale\\private config.json`',
      'Cannot load `\\\\fileserver\\Shared Folder\\private config.json`',
      'Cannot load `file:///Library/Application Support/Retale/private config.json`',
      'Cannot load ~/Private Folder/config.json',
      'Cannot load ./Private Folder/config.json',
      'Cannot load ../Private Folder/config.json',
      'Cannot load </opt/Private Folder/config.json>',
      'Cannot load file://localhost/Users/alice/My Project/config.json',
      'Cannot load file://C:/Program Files/Retale/config.json',
      'https://example.com/download?path=/Users/alice/private/query-config.json',
      'https://example.com/view#file=C:\\Users\\Alice\\fragment-secret.txt',
      'ProviderException: request failed',
      '    at com.example.ProviderClient.send(ProviderClient.java:42)',
      '    at java.base/java.lang.Thread.run(Thread.java:840)',
      'Cannot load file:///Users/alice/project/private-config.json',
      '    from /app/provider_client.rb:43:in `send_request`',
      'https://user:pass@example.com/v1',
      'https://alice:p@ss@word@example.com/v1',
      'https://component-username-token@example.com/v1',
      'sk_live_1234567890ABCDEF',
      'AIza1234567890abcdefghijkl',
      'xoxb-1234567890abcdefghijkl',
      'glpat-1234567890abcdef',
      'npm_1234567890abcdef',
      'gho_1234567890abcdefghijkl',
      'ghs_1234567890abcdefghijkl',
      'ASIAIOSFODNN7EXAMPLE',
      'rk_live_1234567890ABCDEF',
      'whsec_1234567890ABCDEF',
      'ya29.1234567890abcdefghijkl',
      'xapp-1234567890abcdefghijkl',
      'glrt-1234567890abcdef',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxYZ0123456789_-',
      '-----BEGIN PRIVATE KEY-----',
      'truncated-component-private-material',
    ].join('\n')
    const failedStatus = {
      jobId: 'job-sensitive',
      novelId: 'novel-1',
      jobType: 'extract_chapter_knowledge' as const,
      status: 'failed',
      errorMessage: sensitive,
      progress: 0.4,
      currentStep: sensitive,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      etaMinutes: null,
      steps: [{ key: 'extract' as const, label: sensitive, status: 'running' as const, progress: 0.4, etaMinutes: null, detail: sensitive }],
    }
    render(<WorkspaceKnowledgeControls {...buildProps({
      knowledgeRebuildFailed: true,
      mainKnowledgeRebuildStatus: failedStatus,
      knowledgeRebuildFailureMessage: sensitive,
      hanlpBootstrapStatusLine: sensitive,
      hanlpBootstrapPhaseLabel: sensitive,
      hanlpSettingsLine: sensitive,
      rawTextEmbeddingActive: true,
      rawTextEmbeddingStatusLine: sensitive,
      rawTextEmbeddingPhaseBadge: sensitive,
      rawTextEmbeddingSettingsLine: sensitive,
      retrievalTaskStatus: { ...failedStatus, jobType: 'rebuild_retrieval_index' },
      retrievalTaskStatusLabel: sensitive,
      retrievalTaskPhaseLabel: sensitive,
      retrievalIndexStatusLine: sensitive,
      knowledgeRebuildSteps: failedStatus.steps,
      currentKnowledgeRunningStepKey: 'extract',
    })} />)

    const forbidden = /json-basic-secret|quoted-basic-secret|aws-secret-material|client-secret-material|set-cookie-secret|cookie-secret|quoted-private-key-material|pem-private-key-material|\/root\/|\/app\/|\/workspace\/|\/mnt\/|C:\\Users|\\\\fileserver|ProviderClient\.java:42|provider_client\.rb:43|user:pass/i
    const summary = screen.getByTestId('workspace-knowledge-status')
    expect(summary).not.toHaveTextContent(forbidden)
    expect(summary).not.toHaveTextContent('Thread.java:840')
    expect(summary).not.toHaveTextContent('/Users/alice/project/private-config.json')
    expect(summary).not.toHaveTextContent(/array-first-secret|array-second-secret|cookie-array-first|cookie-array-second|set-cookie-first|set-cookie-second/)
    expect(summary).not.toHaveTextContent(/tuple-first-secret|tuple-second-secret|token-array-first|token-array-second|object-first-secret|object-second-secret|Private Folder|sk_live_|AIza|xoxb-|glpat-|npm_|truncated-component/)
    expect(summary).not.toHaveTextContent(/arrow-component-secret|p@ss@word|eyJhbGci|localhost\/Users|file:\/\/C:/)
    expect(summary).not.toHaveTextContent(/component-x-api-secret|component-passwd-secret|component-passphrase|component-escaped-json-secret|query-config|fragment-secret|component-username-token|gho_|ASIAIOS|rk_live_|whsec_|ya29\.|xapp-|glrt-/)
    expect(summary).not.toHaveTextContent(/component-x-client-secret|component-proxy-secret|component-spaced-key-secret|component-connect-session-secret|component-bracket-secret|component-network-secret|ghs_/)
    expect(summary).not.toHaveTextContent(/component-unquoted|component-prefixed-connect|component-session-id|component-first|component-second|component-query-bare|component-fragment-bare|component-encoded/)
    expect(summary).not.toHaveTextContent(/component-mixed/)
    expect(summary).not.toHaveTextContent(/component-stale/)
    expect(summary).not.toHaveTextContent(/component-global/)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))
    const advanced = screen.getByTestId('workspace-knowledge-advanced-details')
    expect(advanced).toHaveTextContent('Retry provider request through /api/knowledge-view')
    expect(advanced).toHaveTextContent('https://host?note=hello%20world/docs&next=%2Fapi/knowledge-view')
    expect(advanced).toHaveTextContent('https://host?time=12:%30%30&next=/api/knowledge-view&ratio=0/64')
    expect(advanced).toHaveTextContent('note=hello%20world/docs next=%2Fapi%2Fknowledge-view ratio=0%2F64')
    expect(advanced).toHaveTextContent('[REDACTED]')
    expect(advanced).toHaveTextContent('[local path]')
    expect(advanced).not.toHaveTextContent(forbidden)
    expect(advanced).not.toHaveTextContent('Thread.java:840')
    expect(advanced).not.toHaveTextContent('/Users/alice/project/private-config.json')
    expect(advanced).not.toHaveTextContent(/array-first-secret|array-second-secret|cookie-array-first|cookie-array-second|set-cookie-first|set-cookie-second|My App|Program Files|Shared Folder|Application Support/)
    expect(advanced).not.toHaveTextContent(/tuple-first-secret|tuple-second-secret|token-array-first|token-array-second|object-first-secret|object-second-secret|Private Folder|sk_live_|AIza|xoxb-|glpat-|npm_|truncated-component/)
    expect(advanced).not.toHaveTextContent(/arrow-component-secret|p@ss@word|eyJhbGci|localhost\/Users|file:\/\/C:/)
    expect(advanced).not.toHaveTextContent(/component-x-api-secret|component-passwd-secret|component-passphrase|component-escaped-json-secret|query-config|fragment-secret|component-username-token|gho_|ASIAIOS|rk_live_|whsec_|ya29\.|xapp-|glrt-/)
    expect(advanced).not.toHaveTextContent(/component-x-client-secret|component-proxy-secret|component-spaced-key-secret|component-connect-session-secret|component-bracket-secret|component-network-secret|ghs_/)
    expect(advanced).not.toHaveTextContent(/component-unquoted|component-prefixed-connect|component-session-id|component-first|component-second|component-query-bare|component-fragment-bare|component-encoded/)
    expect(advanced).not.toHaveTextContent(/component-mixed/)
    expect(advanced).not.toHaveTextContent(/component-stale/)
    expect(advanced).not.toHaveTextContent(/component-global/)
  })

  it('gives every visible advanced action and field a mobile 44px target with desktop reset classes', () => {
    render(<WorkspaceKnowledgeControls {...buildProps({ knowledgeRebuildRangeMode: 'custom' })} />)
    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))

    const advanced = screen.getByTestId('workspace-knowledge-advanced-details')
    const controls = Array.from(advanced.querySelectorAll('button, input, select'))
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(control).toHaveClass('min-h-11')
      expect(control).toHaveClass('lg:min-h-0')
      if (control instanceof HTMLButtonElement) expect(control).toHaveAttribute('type', 'button')
    }
  })

  it('preserves retrieval pause and abort callbacks in advanced controls', () => {
    const onPauseKnowledge = vi.fn()
    const onAbortKnowledge = vi.fn()
    const retrievalTaskStatus = {
      jobId: 'retrieval-1',
      novelId: 'novel-1',
      jobType: 'rebuild_retrieval_index' as const,
      status: 'running',
      progress: 0.8,
      currentStep: 'index',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      etaMinutes: 1,
      steps: [{ key: 'index' as const, label: 'Index', status: 'running' as const, progress: 0.3, etaMinutes: 1, detail: null }],
    }
    render(<WorkspaceKnowledgeControls {...buildProps({
      retrievalTaskStatus,
      retrievalControlsState: resolveRetrievalTaskControlsState({
        retrievalTask: retrievalTaskStatus,
        retrievalIndexOverview: { status: 'partial' },
        knowledgeRebuildStatus: retrievalTaskStatus,
        knowledgeActionLoading: null,
        knowledgeRebuilding: false,
      }),
      onPauseKnowledge,
      onAbortKnowledge,
    })} />)

    fireEvent.click(screen.getByRole('button', { name: /workspace.knowledge.status.advancedDetails/ }))
    fireEvent.click(screen.getByRole('button', { name: 'workspace.knowledge.action.pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'workspace.knowledge.action.abort' }))
    expect(onPauseKnowledge).toHaveBeenCalledTimes(1)
    expect(onAbortKnowledge).toHaveBeenCalledTimes(1)
  })
})
