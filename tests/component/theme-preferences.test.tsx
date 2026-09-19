// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemePreferencesProvider } from '@/components/ThemePreferencesProvider'
import { FontPreferencesProvider } from '@/components/FontPreferencesProvider'
import { WorkspaceAppearanceSettings } from '@/components/workspace/WorkspaceAppearanceSettings'
import { DEFAULT_FONT_PREFERENCES, FONT_PREFERENCES_COOKIE } from '@/lib/font-preferences'
import { parseThemePreference, THEME_PREFERENCE_COOKIE } from '@/lib/theme-preferences'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.cookie = `${THEME_PREFERENCE_COOKIE}=; Max-Age=0; Path=/`
  document.cookie = `${FONT_PREFERENCES_COOKIE}=; Max-Age=0; Path=/`
  delete document.documentElement.dataset.theme
})

function renderAppearance(initialTheme = parseThemePreference(undefined)) {
  return render(
    <ThemePreferencesProvider initialTheme={initialTheme}>
      <FontPreferencesProvider initialPreferences={DEFAULT_FONT_PREFERENCES}>
        <WorkspaceAppearanceSettings />
      </FontPreferencesProvider>
    </ThemePreferencesProvider>,
  )
}

describe('appearance themes', () => {
  it('applies and persists a theme independently of font preferences', () => {
    renderAppearance()
    fireEvent.click(screen.getByRole('radio', { name: '护眼绿' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'green')
    expect(document.cookie).toContain(`${THEME_PREFERENCE_COOKIE}=green`)
    fireEvent.change(screen.getByLabelText('界面字体', { exact: true }), { target: { value: 'arial' } })
    fireEvent.click(screen.getByRole('radio', { name: '浅色' }))
    expect(screen.getByLabelText('界面字体', { exact: true })).toHaveValue('arial')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    fireEvent.click(screen.getByRole('button', { name: '恢复默认字体' }))
    expect(screen.getByRole('radio', { name: '浅色' })).toBeChecked()
    expect(document.cookie).toContain(`${THEME_PREFERENCE_COOKIE}=light`)
  })

  it('restores a valid server preference and rejects unknown cookie values', () => {
    expect(parseThemePreference('invalid')).toBe('dark')
    expect(parseThemePreference(undefined)).toBe('dark')
    renderAppearance(parseThemePreference('green'))
    expect(screen.getByRole('radio', { name: '护眼绿' })).toBeChecked()
  })

  it('still applies the color scheme when cookies cannot be saved', () => {
    renderAppearance()
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => { throw new Error('Blocked') })
    fireEvent.click(screen.getByRole('radio', { name: '浅色' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(screen.getByRole('status')).toHaveTextContent('主题已应用，但浏览器无法保存偏好。')
  })
})
