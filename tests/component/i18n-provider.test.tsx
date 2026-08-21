// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider, useI18n } from '@/lib/i18n/provider'
import { LOCALE_COOKIE_KEY, LOCALE_STORAGE_KEY } from '@/lib/i18n/messages'

function LocaleProbe() {
  const { locale, setLocale } = useI18n()
  return (
    <div>
      <output data-testid="locale">{locale}</output>
      <button type="button" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>toggle</button>
    </div>
  )
}

describe('I18nProvider browser persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.cookie = `${LOCALE_COOKIE_KEY}=; Path=/; Max-Age=0`
    document.documentElement.lang = 'zh-CN'
    delete document.documentElement.dataset.locale
  })

  it('uses the server locale during hydration and migrates an older localStorage preference when no cookie exists', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(
      <I18nProvider initialLocale="zh" localeCookiePresent={false}>
        <LocaleProbe />
      </I18nProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('en'))
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dataset.locale).toBe('en')
    expect(document.cookie).toContain(`${LOCALE_COOKIE_KEY}=en`)
  })

  it('keeps a valid server cookie authoritative over stale localStorage', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh')
    render(
      <I18nProvider initialLocale="en" localeCookiePresent>
        <LocaleProbe />
      </I18nProvider>,
    )

    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    await waitFor(() => expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en'))
  })

  it('persists user changes and synchronizes storage events from another tab', async () => {
    render(
      <I18nProvider initialLocale="zh" localeCookiePresent>
        <LocaleProbe />
      </I18nProvider>,
    )
    await waitFor(() => expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh'))

    act(() => screen.getByRole('button', { name: 'toggle' }).click())
    await waitFor(() => expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en'))

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: LOCALE_STORAGE_KEY,
        newValue: 'zh',
        storageArea: window.localStorage,
      }))
    })
    expect(screen.getByTestId('locale')).toHaveTextContent('zh')
  })
})
