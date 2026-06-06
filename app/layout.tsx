import type { Metadata } from 'next'
import { Geist, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import { I18nProvider } from '@/lib/i18n/provider'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const notoSansSC = Noto_Sans_SC({
  variable: '--font-noto-sans-sc',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const notoSerifSC = Noto_Serif_SC({
  variable: '--font-noto-serif-sc',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Novel Workspace',
  description: 'Self-hosted single-user novel writing workspace',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${notoSansSC.variable} ${notoSerifSC.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#0a0c12] text-zinc-100">
        <I18nProvider>
          <LanguageSwitcher />
          {children}
        </I18nProvider>
      </body>
    </html>
  )
}
