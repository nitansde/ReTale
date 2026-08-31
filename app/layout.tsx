import type { Metadata } from 'next'
import { Geist, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
import { cookies } from 'next/headers'
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
  const storedLocale = (await cookies()).get(LOCALE_STORAGE_KEY)?.value
  const localeCookiePresent = Boolean(storedLocale && isLocale(storedLocale))
  const initialLocale = localeCookiePresent && storedLocale && isLocale(storedLocale) ? storedLocale : 'zh'

  return (
    <html
      lang={initialLocale === 'zh' ? 'zh-CN' : 'en'}
      data-locale={initialLocale}
      className={`${geistSans.variable} ${notoSansSC.variable} ${notoSerifSC.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#0a0c12] text-zinc-100">
        <I18nProvider initialLocale={initialLocale} localeCookiePresent={localeCookiePresent}>
          {children}
        </I18nProvider>
      </body>
    </html>
  )
}
