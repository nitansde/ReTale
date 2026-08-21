// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspacePaneState } from '@/components/workspace/use-workspace-pane-state'
import { WORKSPACE_PREFERENCES_STORAGE_KEY } from '@/lib/browser-preferences'

describe('workspace pane browser preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('hydrates stable view preferences without persisting transient panel state', async () => {
    window.localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 1,
      centerPaneView: 'graph',
      refTab: 'timeline',
      leftPanelOpen: true,
    }))
    const { result } = renderHook(() => useWorkspacePaneState())

    await waitFor(() => expect(result.current.centerPaneView).toBe('graph'))
    expect(result.current.refTab).toBe('timeline')
    expect(result.current.leftPanelOpen).toBe(false)
  })

  it('writes versioned preferences and accepts cross-tab updates', async () => {
    const { result } = renderHook(() => useWorkspacePaneState())
    await waitFor(() => expect(window.localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).not.toBeNull())

    act(() => {
      result.current.setCenterPaneView('graph')
      result.current.setRefTab('outline')
    })
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 1,
      centerPaneView: 'graph',
      refTab: 'outline',
    }))

    const external = JSON.stringify({ version: 1, centerPaneView: 'body', refTab: 'locations' })
    window.localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, external)
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: WORKSPACE_PREFERENCES_STORAGE_KEY,
        newValue: external,
        storageArea: window.localStorage,
      }))
    })
    expect(result.current.centerPaneView).toBe('body')
    expect(result.current.refTab).toBe('locations')
  })
})
