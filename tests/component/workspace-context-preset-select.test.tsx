// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceContextPresetSelect } from '@/components/workspace/WorkspaceContextPresetSelect'
import { I18nProvider } from '@/lib/i18n/provider'
import { resetClientRequestBrokerForTests } from '@/lib/client-request-broker'
import { normalizePresetCompatPresetImport } from '@/lib/preset-compat/normalize'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { useNovelStore } from '@/store/novel-store'

function makeLibrary() {
  const library = createDefaultPresetCompatLibrary()
  for (const id of ['first', 'second']) {
    library.presets[id] = normalizePresetCompatPresetImport({ name: id, main_prompt: 'Write vivid prose.' }, { idFactory: () => id }).preset
  }
  library.surfaceBindings.rewrite = { ...library.surfaceBindings.rewrite, presetId: 'first', enabled: true }
  return library
}

beforeEach(() => {
  resetClientRequestBrokerForTests()
  useNovelStore.setState({ presetCompatLibrary: createDefaultPresetCompatLibrary(), presetCompatLibraryDirty: false, presetCompatLibraryLoading: false, presetCompatLibraryError: '' })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('advanced-context preset selection', () => {
  it('loads the actual binding and persists changes only to the current book, including no preset', async () => {
    let saved = makeLibrary()
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        saved = JSON.parse(String(init.body)).library
        return Response.json({ ok: true, library: saved })
      }
      return Response.json(saved)
    })
    vi.stubGlobal('fetch', fetchMock)
    const openLibrary = vi.fn()
    render(<WorkspaceContextPresetSelect novelId="book-a" disabled={false} onOpenLibrary={openLibrary} />)
    const select = screen.getByRole('combobox', { name: '当前预设' })
    await waitFor(() => expect(select).toHaveValue('first'))
    const roleplayBinding = saved.surfaceBindings.roleplay
    fireEvent.change(select, { target: { value: 'second' } })
    expect(select).toBeDisabled()
    await waitFor(() => expect(select).toBeEnabled())
    expect(saved.novelRewritePresetIds?.['book-a']).toBe('second')
    expect(saved.surfaceBindings.rewrite.presetId).toBe('first')
    expect(saved.novelRewritePresetIds?.['book-b']).toBeUndefined()
    expect(saved.surfaceBindings.roleplay).toEqual(roleplayBinding)
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => expect(select).toBeEnabled())
    expect(saved.novelRewritePresetIds?.['book-a']).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '管理预设' }))
    expect(openLibrary).toHaveBeenCalledOnce()
  })

  it('keeps a failed save visible and retries the chosen preset', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (fail) return Response.json({ error: 'save failed' }, { status: 500 })
        return Response.json({ ok: true, library: JSON.parse(String(init.body)).library })
      }
      return Response.json(makeLibrary())
    }))
    render(<WorkspaceContextPresetSelect novelId="book-a" disabled={false} onOpenLibrary={() => {}} />)
    const select = screen.getByRole('combobox', { name: '当前预设' })
    await waitFor(() => expect(select).toHaveValue('first'))
    fireEvent.change(select, { target: { value: 'second' } })
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(select).toHaveValue('second')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(useNovelStore.getState().presetCompatLibraryDirty).toBe(false)
  })

  it('preserves unsaved editor changes and disables editing during generation with localized labels', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useNovelStore.setState({ presetCompatLibrary: makeLibrary(), presetCompatLibraryDirty: true })
    render(<I18nProvider initialLocale="en" localeCookiePresent><WorkspaceContextPresetSelect novelId="book-a" disabled onOpenLibrary={() => {}} /></I18nProvider>)
    expect(screen.getByRole('combobox', { name: 'Current preset' })).toHaveValue('first')
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Manage presets' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
