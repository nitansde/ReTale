import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function htmlToPlainText(html: string) {
  return html
    .replace(/<\/p>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function countChineseFriendlyWords(text: string) {
  return text.replace(/\s/g, '').length
}

export function plainTextToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.trim() || '　'}</p>`)
    .join('')
}

export function getParagraphsFromHtml(html: string) {
  const text = htmlToPlainText(html)
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function formatNowLabel() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}
