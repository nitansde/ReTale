// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextCompressionControl, ContextCompressionWarning } from '@/components/workspace/ContextCompressionControl'
import type { ContextCompressionPreview } from '@/lib/context-compression'
import { I18nProvider } from '@/lib/i18n/provider'

const preview: ContextCompressionPreview = { scope: { novelId: 'novel', branchId: 'main', branchContextNodeId: 'node', branchContextInclusion: 'include_selected' }, fingerprint: 'unchanged', totalChapters: 5, compressedChapters: 1, chapters: Array.from({ length: 5 }, (_, i) => ({ label: `Chapter ${i + 1}`, tokenEstimate: 50000 })), summary: '已有摘要', tokenEstimate: 220000 }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const show = (tokens: number, onContextChanged = vi.fn()) => render(<I18nProvider><ContextCompressionWarning preview={preview} tokenEstimate={tokens} /><ContextCompressionControl preview={preview} onContextChanged={onContextChanged} /></I18nProvider>)

describe('context compression control', () => {
  it('updates savings as the additional chapter count changes, and uses the returned summary for achieved savings', async () => {
    const current = { ...preview, summary: '文'.repeat(1600) }
    const next = { ...current, compressedChapters: 3, summary: '文'.repeat(3200) }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, compression: next })))
    const refresh = vi.fn()
    render(<I18nProvider><ContextCompressionControl preview={current} onContextChanged={refresh} /></I18nProvider>)
    expect(screen.getByTestId('compression-saved-tokens')).toHaveTextContent('累计节省约 49,000 tokens')
    fireEvent.click(screen.getByRole('button', { name: '继续压缩上下文' }))
    const input = screen.getByRole('spinbutton', { name: '本次再压缩' })
    fireEvent.change(input, { target: { value: '1' } })
    expect(screen.getByTestId('compression-estimated-savings')).toHaveTextContent('预计节省约 49,750 tokens')
    expect(screen.getByTestId('compression-estimated-savings')).toHaveTextContent('51,000 → 摘要约 1,250 tokens')
    fireEvent.change(input, { target: { value: '2' } })
    expect(screen.getByTestId('compression-estimated-savings')).toHaveTextContent('预计节省约 99,750 tokens')
    expect(screen.getByTestId('compression-estimated-savings')).toHaveTextContent('实际以模型生成的摘要为准')
    fireEvent.change(input, { target: { value: '5' } })
    expect(screen.queryByTestId('compression-estimated-savings')).toBeNull()
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '合并摘要并压缩' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(screen.getByTestId('compression-saved-tokens')).toHaveTextContent('累计节省约 148,000 tokens')
  })

  it('expands all compressed history without calling the model and refreshes context', async () => {
    const expanded = { ...preview, compressedChapters: 0, summary: null, tokenEstimate: 260000, fingerprint: 'expanded' }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true, compression: expanded }))
    vi.stubGlobal('fetch', fetcher)
    const refresh = vi.fn()
    const view = show(180000, refresh)
    expect(screen.getByText(/将已压缩的前 1 章恢复为原始生成全文/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开上下文' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('/api/context/compress')
    expect(fetcher.mock.calls[0][1]?.method).toBe('DELETE')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ scope: preview.scope, fingerprint: preview.fingerprint })
    expect(screen.getByRole('status')).toHaveTextContent('已展开前 1 章')
    view.rerender(<I18nProvider><ContextCompressionWarning preview={expanded} tokenEstimate={expanded.tokenEstimate} /><ContextCompressionControl preview={expanded} onContextChanged={refresh} /></I18nProvider>)
    expect(screen.queryByRole('button', { name: '展开上下文' })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('200K')
    fireEvent.click(screen.getByRole('button', { name: /压缩上下文/ }))
    expect(screen.getByRole('spinbutton')).toHaveAttribute('min', '1')
  })

  it('blocks duplicate mutations while expansion is pending and retains the summary on failure', async () => {
    let reject!: (reason: Error) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, fail) => { reject = fail })))
    const refresh = vi.fn(), onBusyChange = vi.fn()
    render(<I18nProvider><ContextCompressionControl preview={preview} onContextChanged={refresh} onBusyChange={onBusyChange} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '展开上下文' }))
    expect(screen.getByRole('button', { name: '正在展开…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /压缩上下文/ })).toBeDisabled()
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    reject(new Error('展开失败：连接中断'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('展开失败：连接中断'))
    expect(refresh).not.toHaveBeenCalled()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: '展开上下文' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /压缩上下文/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('已有摘要')
  })

  it('warns only above 200K and presents the current chapter count and a bounded prefix picker', () => {
    const view = show(200000)
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount()
    show(200001)
    expect(screen.getByRole('alert')).toHaveTextContent('200K')
    fireEvent.click(screen.getByRole('button', { name: /压缩上下文/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('历史共 5 章')
    expect(screen.getByRole('dialog')).toHaveTextContent('原著正文不参与压缩')
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '1')
    expect(input).toHaveAttribute('max', '4')
    fireEvent.change(input, { target: { value: '6' } })
    expect(screen.getByRole('button', { name: '合并摘要并压缩' })).toBeDisabled()
  })

  it('adds only the newly selected chapters to the existing compressed prefix', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, compression: { ...preview, compressedChapters: 3 } })))
    vi.stubGlobal('fetch', fetcher)
    const refresh = vi.fn()
    show(220000, refresh)
    fireEvent.click(screen.getByRole('button', { name: /压缩上下文/ }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '本次再压缩' }), { target: { value: '2' } })
    const selection = screen.getByTestId('compression-selection')
    expect(selection).toHaveTextContent('本次选择：第 2–3 章（2 章）')
    expect(selection).toHaveTextContent('Chapter 2 → Chapter 3')
    expect(selection).toHaveTextContent('沿用前 1 章的摘要')
    fireEvent.click(screen.getByRole('button', { name: '合并摘要并压缩' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    const request = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(request).toEqual({ scope: preview.scope, count: 3, fingerprint: 'unchanged' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('本次新增压缩 2 章，摘要现覆盖前 3 章')
    expect(screen.getByTestId('compression-history-status')).toHaveTextContent('3 章已压缩 · 2 章未压缩')
    // The returned preview is usable even if the parent refresh is delayed.
    fireEvent.click(screen.getByRole('button', { name: '继续压缩上下文' }))
    expect(screen.getByRole('spinbutton')).toHaveAttribute('max', '2')
    expect(screen.getByTestId('compression-selection')).toHaveTextContent('本次选择：第 4 章（1 章）')
  })

  it('keeps the selection and old context available when the provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '模型暂时不可用' }), { status: 500 })))
    const refresh = vi.fn()
    show(180000, refresh)
    fireEvent.click(screen.getByRole('button', { name: /压缩上下文/ }))
    fireEvent.click(screen.getByRole('button', { name: '合并摘要并压缩' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('模型暂时不可用'))
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '合并摘要并压缩' })).toBeEnabled()
  })

  it('shows the saved summary, offers all remaining chapters, and re-enables compression when new chapters arrive', async () => {
    const full = { ...preview, compressedChapters: 5, summary: '五章的摘要', fingerprint: 'all-compressed' }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true, compression: full }))
    vi.stubGlobal('fetch', fetcher)
    const refresh = vi.fn()
    const view = show(180000, refresh)
    expect(screen.getByTestId('compression-history-status')).toHaveTextContent('第 2–5 章 · 保留全文')
    fireEvent.click(screen.getByText('查看当前摘要'))
    expect(screen.getByText('已有摘要')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续压缩上下文' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '全部剩余（4 章）' }))
    expect(within(dialog).getByRole('spinbutton')).toHaveValue(4)
    expect(within(dialog).getByTestId('compression-selection')).toHaveTextContent('其余 0 章保持全文')
    fireEvent.click(within(dialog).getByRole('button', { name: '合并摘要并压缩' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).count).toBe(5)
    expect(screen.getByRole('button', { name: '已全部压缩' })).toBeDisabled()
    expect(screen.getByText('生成新内容后可继续压缩。', { exact: false })).toBeVisible()
    expect(screen.getByRole('button', { name: '展开上下文' })).toBeEnabled()
    expect(screen.getByText('五章的摘要')).toBeInTheDocument()
    const more = { ...full, totalChapters: 7, fingerprint: 'new-history', chapters: [...full.chapters, { label: 'Chapter 6', tokenEstimate: 1000 }, { label: 'Chapter 7', tokenEstimate: 1000 }] }
    view.rerender(<I18nProvider><ContextCompressionControl preview={more} onContextChanged={refresh} /></I18nProvider>)
    expect(screen.getByTestId('compression-history-status')).toHaveTextContent('历史共 7 章 · 5 章已压缩 · 2 章未压缩')
    fireEvent.click(screen.getByRole('button', { name: '继续压缩上下文' }))
    expect(screen.getByRole('spinbutton', { name: '本次再压缩' })).toHaveAttribute('max', '2')
    expect(screen.getByTestId('compression-selection')).toHaveTextContent('第 6 章（1 章）')
  })

  it('starts from chapter one before any compression and accepts an empty initial preview', () => {
    const view = render(<I18nProvider><ContextCompressionControl onContextChanged={vi.fn()} /></I18nProvider>)
    expect(screen.queryByTestId('context-compression-control')).toBeNull()
    view.rerender(<I18nProvider><ContextCompressionControl preview={{ ...preview, compressedChapters: 0, summary: null }} onContextChanged={vi.fn()} /></I18nProvider>)
    expect(screen.queryByRole('button', { name: '展开上下文' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '压缩上下文' }))
    expect(screen.getByRole('spinbutton', { name: '本次压缩' })).toHaveAttribute('max', '5')
    expect(screen.getByTestId('compression-selection')).toHaveTextContent('第 1–3 章（3 章）')
    expect(screen.getByRole('button', { name: '开始压缩' })).toBeEnabled()
  })

  it('does not point users to a disabled compression action when all history is compressed', () => {
    render(<I18nProvider><ContextCompressionWarning preview={{ ...preview, compressedChapters: 5 }} tokenEstimate={230000} /></I18nProvider>)
    expect(screen.getByRole('alert')).toHaveTextContent('生成历史已全部使用摘要')
    expect(screen.getByRole('alert')).not.toHaveTextContent('点击“压缩上下文”')
  })
})
