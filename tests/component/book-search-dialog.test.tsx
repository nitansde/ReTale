// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookSearchDialog } from '@/components/workspace/BookSearchDialog'

vi.mock('@/lib/i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
afterEach(() => vi.unstubAllGlobals())
const match = { chapterId: 'two', chapterNo: 2, chapterTitle: '重逢', text: '她终于回来了。', searchText: '她终于回来了。', kind: 'semantic', lineStart: 1, lineEnd: 1 }

function mount(semanticAvailable = true) {
  const searchFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url.includes('capabilities=1')
    ? Promise.resolve(new Response(JSON.stringify({ semanticAvailable })))
    : searchFetch(url, init))
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const view = render(<BookSearchDialog novelId="novel" onSelect={onSelect} onClose={onClose} />)
  return { ...view, onSelect, onClose }
}
function submit(query: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
  fireEvent.submit(screen.getByRole('search'))
}

describe('book search dialog', () => {
  it('focuses the query, displays semantic results, and opens the chosen original passage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: '回来', mode: 'semantic', matches: [match] }))))
    const { onSelect, onClose } = mount()
    expect(screen.getByRole('searchbox')).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'bookSearch.semantic' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'bookSearch.exact' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'bookSearch.submit' })).toBeDisabled()
    submit('回来')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('bookSearch.semantic'))
    expect(screen.getByText('回来', { selector: 'mark' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重逢/ }))
    expect(onSelect).toHaveBeenCalledWith(match)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('discards an older response after the query changes and cancels on unmount', async () => {
    let resolve!: (value: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetchMock)
    const view = mount()
    submit('过去')
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '现在' } })
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(new Response(JSON.stringify({ query: '过去', mode: 'exact', matches: [match] }))))
    expect(screen.queryByText('重逢')).not.toBeInTheDocument()
    submit('现在')
    const latestSignal = fetchMock.mock.calls[1][1].signal as AbortSignal
    view.unmount()
    expect(latestSignal.aborted).toBe(true)
  })

  it('sends the selected mode and cancels old requests when switching modes', async () => {
    let resolve!: (value: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    submit('red fox')
    expect(new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams.get('mode')).toBe('semantic')
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    fireEvent.click(screen.getByRole('radio', { name: 'bookSearch.exact' }))
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('searchbox')).toHaveValue('red fox')
    expect(screen.getByRole('status')).toHaveTextContent('bookSearch.exactHint')
    await act(async () => resolve(new Response(JSON.stringify({ query: 'red fox', mode: 'semantic', matches: [match] }))))
    expect(screen.queryByText('重逢')).not.toBeInTheDocument()
    fireEvent.submit(screen.getByRole('search'))
    expect(new URL(fetchMock.mock.calls[1][0], 'http://localhost').searchParams.get('mode')).toBe('exact')
  })

  it('shows the missing embedding reminder as soon as semantic mode is selected', async () => {
    vi.stubGlobal('fetch', vi.fn())
    mount(false)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bookSearch.missingEmbeddingBeforeSearch'))
    fireEvent.click(screen.getByRole('radio', { name: 'bookSearch.exact' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'bookSearch.semantic' }))
    expect(screen.getByRole('alert')).toHaveTextContent('bookSearch.missingEmbeddingBeforeSearch')
  })

  it('warns explicitly when embeddings are missing and preserves rewrite navigation targets', async () => {
    const rewrite = { ...match, kind: 'exact', sourceType: 'rewrite', selection: { kind: 'rewrite', nodeId: 'node', continueBlockId: 'rewrite', anchorChapterNo: 2 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      query: '回来', mode: 'exact', fallback: true, fallbackReason: 'missing_embedding', matches: [rewrite],
    }))))
    const { onSelect } = mount()
    submit('回来')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bookSearch.missingEmbedding'))
    expect(screen.getByText('bookSearch.rewrite')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重逢/ }))
    expect(onSelect).toHaveBeenCalledWith(rewrite)
  })

  it('shows empty results, fallback explanation, and recoverable network errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: '[x].*', mode: 'exact', fallback: true, matches: [] })))
      .mockRejectedValueOnce(new Error('offline')))
    mount()
    submit('[x].*')
    await screen.findByText('bookSearch.empty')
    expect(screen.getByText('bookSearch.fallback')).toBeInTheDocument()
    submit('再试一次')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bookSearch.error'))
    expect(screen.getByRole('button', { name: 'bookSearch.submit' })).toBeEnabled()
  })
})
