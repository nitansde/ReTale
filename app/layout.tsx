import type { Metadata } from 'next'
import { Geist, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
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
  title: {
    default: 'ReTale · 戏说',
    template: '%s · ReTale · 戏说',
  },
  description: 'ReTale 戏说 is a self-hosted, single-user workspace for rewriting and branching fiction.',
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
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
