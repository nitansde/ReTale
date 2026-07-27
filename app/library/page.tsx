import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import { LibraryPageClient } from '@/components/library/library-page-client'

export default function LibraryPage() {
  return (
    <>
      <LanguageSwitcher />
      <LibraryPageClient />
    </>
  )
}
