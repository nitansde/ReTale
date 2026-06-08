"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMessage, isLocale, type Locale, type TranslationKey, type TranslationValues } from '@/lib/i18n/messages'

const STORAGE_KEY = 'retale.locale'

const defaultContextValue: I18nContextValue = {
  locale: 'zh',
  setLocale: () => undefined,
  t: (key, values) => getMessage('zh', key, values),
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, values?: TranslationValues) => string
}

const I18nContext = createContext<I18nContextValue>(defaultContextValue)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') {
      return 'zh'
    }

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      return stored && isLocale(stored) ? stored : 'zh'
    } catch {
      return 'zh'
    }
  })

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    document.documentElement.dataset.locale = locale
    try {
      window.localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      // Ignore storage access failures in restricted or test environments.
    }
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
  }, [])

  const t = useCallback((key: TranslationKey, values?: TranslationValues) => getMessage(locale, key, values), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
