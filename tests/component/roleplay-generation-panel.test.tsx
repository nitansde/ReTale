// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RoleplayGenerationPanel } from '@/components/workspace/RoleplayGenerationPanel'
import { defaultRoleplayGenerationOptions } from '@/lib/roleplay-generation'
import { buildRequestPromptMessages } from '@/lib/generation-prompt-preview'
import { useNovelStore } from '@/store/novel-store'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function previewResponse(content: string, snapshot: string, tokenEstimate?: number) {
  return Response.json({
    ok: true, systemPrompt: 'system', userPrompt: content, contextSnapshotId: snapshot, tokenEstimate,
    requestMessages: buildRequestPromptMessages('system', content),
    promptBlocks: [{ id: 'current-summary', label: '当前章节摘要', content, enabled: true, priority: 'high', required: false, trimmed: false }],
  })
}

it('displays the complete request estimate below 200K and replaces stale estimates while options refresh', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>()
    .mockResolvedValueOnce(previewResponse('prompt', 'one', 123456))
    .mockResolvedValueOnce(previewResponse('longer prompt', 'two', 235000))
    .mockResolvedValueOnce(previewResponse('shorter prompt', 'three', 45000)))
  const props = { options: defaultRoleplayGenerationOptions(), onChange: vi.fn(), onClose: vi.fn(), onSnapshot: vi.fn() }
  const view = render(<RoleplayGenerationPanel {...props} panel="context" request={{ roleplayTurn: { dialogue: '继续' } }} />)
  expect(screen.getByTestId('roleplay-context-token-estimate')).toHaveTextContent('正在更新 token 估算')
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(screen.getByTestId('roleplay-context-token-estimate')).toHaveTextContent('123,456 tokens')
  expect(screen.getByTestId('roleplay-context-token-estimate')).toHaveTextContent('包含预设、指令和启用的上下文，不含模型输出')
  view.rerender(<RoleplayGenerationPanel {...props} panel="context" request={{ roleplayTurn: { dialogue: '更多历史' } }} />)
  expect(screen.getByTestId('roleplay-context-token-estimate')).not.toHaveTextContent('123,456')
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(screen.getByTestId('roleplay-context-token-estimate')).toHaveTextContent('235,000 tokens')
  expect(screen.getByRole('alert')).toHaveTextContent('200K')
  fireEvent.click(screen.getByRole('button', { name: '刷新上下文' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(screen.getByTestId('roleplay-context-token-estimate')).toHaveTextContent('45,000 tokens')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('stops a stalled context preview, offers a retry, and ignores a late response', async () => {
  vi.useFakeTimers()
  let resolveStalled!: (response: Response) => void
  const fetchMock = vi.fn<typeof fetch>()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveStalled = resolve }))
    .mockResolvedValueOnce(previewResponse('fresh prompt', 'fresh'))
  vi.stubGlobal('fetch', fetchMock)
  const onSnapshot = vi.fn()
  render(<RoleplayGenerationPanel panel="context" request={{ roleplayTurn: { playerName: '甲', counterpartName: '乙' } }} options={defaultRoleplayGenerationOptions()} onChange={vi.fn()} onClose={vi.fn()} onSnapshot={onSnapshot} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(screen.getByRole('status')).toHaveTextContent('正在装配')
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(screen.getByRole('alert')).toHaveTextContent('上下文加载超时')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '刷新上下文' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(screen.getByTestId('prompt-block-content-current-summary')).toHaveTextContent('fresh prompt')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(async () => { resolveStalled(previewResponse('stale prompt', 'stale')) })
  expect(screen.getByTestId('prompt-block-content-current-summary')).not.toHaveTextContent('stale prompt')
  expect(onSnapshot.mock.calls).toEqual([[null], ['fresh']])
})

it('refreshes the displayed request when the saved preset revision changes', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(previewResponse('原预设的任务', 'old'))
    .mockResolvedValueOnce(previewResponse('新预设的任务', 'new'))
  vi.stubGlobal('fetch', fetchMock)
  const revision = useNovelStore.getState().presetCompatLibrary.revision
  const view = render(<RoleplayGenerationPanel panel="context" request={{ roleplayTurn: { playerName: '甲', counterpartName: '乙' } }} options={defaultRoleplayGenerationOptions()} onChange={vi.fn()} onClose={vi.fn()} onSnapshot={vi.fn()} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(screen.getByTestId('prompt-block-content-current-summary')).toHaveTextContent('原预设的任务')
  act(() => useNovelStore.setState((state) => ({ presetCompatLibrary: { ...state.presetCompatLibrary, revision: revision + 1 } })))
  expect(screen.getByTestId('advanced-context-prompt-panel')).toHaveAttribute('aria-busy', 'true')
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(screen.getByTestId('prompt-block-content-current-summary')).toHaveTextContent('新预设的任务')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  view.unmount()
  useNovelStore.setState((state) => ({ presetCompatLibrary: { ...state.presetCompatLibrary, revision } }))
})

it('preloads before opening and reuses the result across panel switches and reopening', async () => {
  vi.useFakeTimers()
  let finish!: (response: Response) => void
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve }))
  vi.stubGlobal('fetch', fetchMock)
  const props = { request: { roleplayTurn: { playerName: '甲', counterpartName: '乙' } }, options: defaultRoleplayGenerationOptions(), onChange: vi.fn(), onClose: vi.fn(), onSnapshot: vi.fn() }
  const view = render(<RoleplayGenerationPanel {...props} panel={null} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(fetchMock).toHaveBeenCalledOnce()
  view.rerender(<RoleplayGenerationPanel {...props} panel="context" />)
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
  await act(async () => { finish(previewResponse('prepared prompt', 'snapshot')) })
  expect(screen.getByTestId('prompt-block-content-current-summary')).toHaveTextContent('prepared prompt')
  view.rerender(<RoleplayGenerationPanel {...props} panel={null} />)
  view.rerender(<RoleplayGenerationPanel {...props} panel="context" />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByTestId('prompt-block-content-current-summary')).toHaveTextContent('prepared prompt')
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(fetchMock).toHaveBeenCalledOnce()
})
