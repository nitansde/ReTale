import type { Metadata } from 'next'
import { Geist, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
import { cookies } from 'next/headers'
import { FontPreferencesProvider } from '@/components/FontPreferencesProvider'
import { ThemePreferencesProvider } from '@/components/ThemePreferencesProvider'
import { FONT_PREFERENCES_COOKIE, getFontPreferenceStyles, parseFontPreferences } from '@/lib/font-preferences'
import { parseThemePreference, THEME_PREFERENCE_COOKIE } from '@/lib/theme-preferences'
import { I18nProvider } from '@/lib/i18n/provider'
import { isLocale, LOCALE_STORAGE_KEY } from '@/lib/i18n/messages'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const notoSansSC = Noto_Sans_SC({
  variable: '--font-noto-sans-sc',
  subsets: ['latin'],
  weight: 'variable',
})

const notoSerifSC = Noto_Serif_SC({
  variable: '--font-noto-serif-sc',
  subsets: ['latin'],
  weight: 'variable',
})

export const metadata: Metadata = {
  title: {
    default: 'ReTale · 戏说',
    template: '%s · ReTale · 戏说',
  },
  description: 'ReTale 戏说 is a self-hosted, single-user workspace for rewriting and branching fiction.',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const storedLocale = cookieStore.get(LOCALE_STORAGE_KEY)?.value
  const fontPreferences = parseFontPreferences(cookieStore.get(FONT_PREFERENCES_COOKIE)?.value)
  const initialTheme = parseThemePreference(cookieStore.get(THEME_PREFERENCE_COOKIE)?.value)
  const localeCookiePresent = Boolean(storedLocale && isLocale(storedLocale))
  const initialLocale = localeCookiePresent && storedLocale && isLocale(storedLocale) ? storedLocale : 'zh'

  return (
    <html
      lang={initialLocale === 'zh' ? 'zh-CN' : 'en'}
      data-locale={initialLocale}
      data-theme={initialTheme}
      style={getFontPreferenceStyles(fontPreferences)}
      className={`${geistSans.variable} ${notoSansSC.variable} ${notoSerifSC.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-zinc-100">
        <I18nProvider initialLocale={initialLocale} localeCookiePresent={localeCookiePresent}>
          <ThemePreferencesProvider initialTheme={initialTheme}>
            <FontPreferencesProvider initialPreferences={fontPreferences}>
              {children}
            </FontPreferencesProvider>
          </ThemePreferencesProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
