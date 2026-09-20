// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RoleplayGenerationPanel } from '@/components/workspace/RoleplayGenerationPanel'
import { defaultRoleplayGenerationOptions } from '@/lib/roleplay-generation'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('stops a stalled context preview, offers a retry, and ignores a late response', async () => {
  vi.useFakeTimers()
  let resolveStalled!: (response: Response) => void
  const fetchMock = vi.fn<typeof fetch>()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveStalled = resolve }))
    .mockResolvedValueOnce(Response.json({ ok: true, promptBlocks: [], systemPrompt: 'system', userPrompt: 'fresh prompt', contextSnapshotId: 'fresh' }))
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
  expect(screen.getByTestId('roleplay-final-prompt')).toHaveTextContent('fresh prompt')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(async () => { resolveStalled(Response.json({ ok: true, promptBlocks: [], userPrompt: 'stale prompt', contextSnapshotId: 'stale' })) })
  expect(screen.getByTestId('roleplay-final-prompt')).not.toHaveTextContent('stale prompt')
  expect(onSnapshot.mock.calls).toEqual([[null], ['fresh']])
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
  await act(async () => { finish(Response.json({ ok: true, promptBlocks: [], systemPrompt: 'system', userPrompt: 'prepared prompt', contextSnapshotId: 'snapshot' })) })
  expect(screen.getByTestId('roleplay-final-prompt')).toHaveTextContent('prepared prompt')
  view.rerender(<RoleplayGenerationPanel {...props} panel={null} />)
  view.rerender(<RoleplayGenerationPanel {...props} panel="context" />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByTestId('roleplay-final-prompt')).toHaveTextContent('prepared prompt')
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(fetchMock).toHaveBeenCalledOnce()
})
