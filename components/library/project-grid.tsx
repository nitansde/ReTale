"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { ProjectCard } from './project-card'
import { Notice, type NoticeVariant } from '@/components/ui/Notice'
import { useI18n } from '@/lib/i18n/provider'
import { toUserFacingWorkspaceError } from '@/lib/workspace-user-facing-errors'
import { useNovelStore } from '@/store/novel-store'

export function resolveOpenNovelChapter(
  localChapters: Array<{
    id: string
    novelId: string | null
    parentChapterId?: string | null
    order: number
  }>,
  novelId: string,
  chapterId?: string,
) {
  if (chapterId) {
    return localChapters.find((item) => item.id === chapterId) ?? null
  }

  return localChapters
    .filter((item) => item.novelId === novelId && !item.parentChapterId)
    .sort((a, b) => a.order - b.order)[0] ?? null
}

type ImportFeedback =
  | { status: 'idle' }
  | { status: 'uploading'; fileName: string; percent: number }
  | { status: 'processing'; fileName: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

type LibraryNotice = {
  variant: NoticeVariant
  message: string
} | null

type ImportFailureReason = 'server' | 'invalid-response' | 'network' | 'refresh' | 'handoff'

type ImportFailure = {
  type: 'import-failure'
  reason: ImportFailureReason
}

function createImportFailure(reason: ImportFailureReason): ImportFailure {
  return { type: 'import-failure', reason }
}

function isImportFailure(error: unknown): error is ImportFailure {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === 'import-failure'
}

type ImportSuccessPayload = {
  novelId: string
  chapterId: string
  chapterCount: number
}

function isImportSuccessPayload(value: unknown): value is ImportSuccessPayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Partial<ImportSuccessPayload>
  return typeof payload.novelId === 'string'
    && payload.novelId.trim().length > 0
    && typeof payload.chapterId === 'string'
    && payload.chapterId.trim().length > 0
    && typeof payload.chapterCount === 'number'
    && Number.isFinite(payload.chapterCount)
    && Number.isInteger(payload.chapterCount)
    && payload.chapterCount >= 0
}

export function ProjectGrid() {
  const { t, locale } = useI18n()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const {
    backendLoadError,
    librarySummariesError,
    getNovels,
    librarySummariesLoaded,
    loadLibrarySummaries,
    loadFromBackend,
    saveToBackend,
    deleteNovelFromBackend,
    reconcileNovelDeletionFromBackend,
    isNovelDeletionPending,
    beginNovelDeletion,
    rollbackNovelDeletion,
    setNovelDeletionPending,
    reconcileNovelDeletion,
    setCurrentNovelId,
    setCurrentChapterId,
  } = useNovelStore()
  const novels = getNovels()
  const [deletingNovelId, setDeletingNovelId] = useState<string | null>(null)
  const [openingNovelId, setOpeningNovelId] = useState<string | null>(null)
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ status: 'idle' })
  const [libraryNotice, setLibraryNotice] = useState<LibraryNotice>(null)
  const deletionInFlightRef = useRef(false)
  const importRequestSequenceRef = useRef(0)
  const activeImportXhrRef = useRef<XMLHttpRequest | null>(null)
  const mountedRef = useRef(true)
  const isImporting = importFeedback.status === 'uploading' || importFeedback.status === 'processing'

  const selectNovelChapter = (novelId: string, chapterId?: string) => {
    const chapter = resolveOpenNovelChapter(useNovelStore.getState().localChapters, novelId, chapterId)

    if (!chapter) {
      return null
    }

    setCurrentNovelId(novelId)
    setCurrentChapterId(chapter.id)
    return chapter
  }

  useEffect(() => {
    if (librarySummariesLoaded) return
    loadLibrarySummaries().catch(() => undefined)
  }, [librarySummariesLoaded, loadLibrarySummaries])
  
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      importRequestSequenceRef.current += 1
      activeImportXhrRef.current?.abort?.()
      activeImportXhrRef.current = null
    }
  }, [])

  const openNovel = async (
    novelId: string,
    chapterId?: string,
    { persistSelection = true }: { persistSelection?: boolean } = {},
  ) => {
    setOpeningNovelId(novelId)

    try {
      await loadFromBackend(novelId)
      const chapter = selectNovelChapter(novelId, chapterId)
      if (!chapter) {
        setOpeningNovelId(null)
        setLibraryNotice({ variant: 'warning', message: t('library.noChapter') })
        return false
      }
      router.push('/workspace')
      if (persistSelection) {
        void saveToBackend().catch((error) => {
          console.warn('Failed to persist the newly opened workspace selection in the background.', error)
        })
      }
      return true
    } catch {
      setLibraryNotice({ variant: 'error', message: t('library.openFailed') })
      setOpeningNovelId(null)
      return false
    }
  }

  const handleImportTxt = async (file: File) => {
    const requestSequence = importRequestSequenceRef.current + 1
    importRequestSequenceRef.current = requestSequence
    activeImportXhrRef.current?.abort?.()
    const ownsRequest = () => mountedRef.current && importRequestSequenceRef.current === requestSequence
    setImportFeedback({ status: 'uploading', fileName: file.name, percent: 0 })
  
    try {
      const formData = new FormData()
      formData.append('file', file)
  
      const data = await new Promise<ImportSuccessPayload>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        activeImportXhrRef.current = xhr
        xhr.open('POST', '/api/import-txt')
  
        xhr.upload.onprogress = (event) => {
          if (ownsRequest() && event.lengthComputable) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
            setImportFeedback({ status: 'uploading', fileName: file.name, percent })
          }
        }
  
        xhr.upload.onload = () => {
          if (ownsRequest()) {
            setImportFeedback({ status: 'processing', fileName: file.name })
          }
        }
  
        xhr.onload = () => {
          if (!ownsRequest()) {
            reject(createImportFailure('network'))
            return
          }
          try {
            const json: unknown = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) {
              if (isImportSuccessPayload(json)) {
                resolve(json)
              } else {
                reject(createImportFailure('invalid-response'))
              }
            } else {
              reject(createImportFailure('server'))
            }
          } catch {
            reject(createImportFailure('invalid-response'))
          }
        }
  
        xhr.onerror = () => reject(createImportFailure('network'))
        xhr.onabort = () => reject(createImportFailure('network'))
        xhr.send(formData)
      })
  
      if (!ownsRequest()) return
      try {
        await loadLibrarySummaries()
      } catch {
        throw createImportFailure('refresh')
      }
  
      if (!ownsRequest()) return
      if (data.chapterCount <= 120) {
        const opened = await openNovel(data.novelId, data.chapterId, { persistSelection: false })
        if (!opened) {
          throw createImportFailure('handoff')
        }
        if (ownsRequest()) {
          setImportFeedback({ status: 'success', message: t('library.importedAndOpening', { count: data.chapterCount }) })
        }
        return
      }
  
      setImportFeedback({ status: 'success', message: t('library.importedRefresh', { count: data.chapterCount }) })
    } catch (error) {
      if (!ownsRequest()) return
      const reason = isImportFailure(error) ? error.reason : 'server'
      const message = reason === 'network'
        ? t('library.uploadFailed')
        : reason === 'invalid-response'
          ? t('library.invalidServerResult')
          : reason === 'refresh'
            ? t('library.importRefreshFailed')
            : reason === 'handoff'
              ? t('library.importHandoffFailed')
              : t('library.importFailed')
      setImportFeedback({ status: 'error', message })
    } finally {
      if (ownsRequest()) {
        activeImportXhrRef.current = null
      }
    }
  }

  const handleDeleteNovel = async (novelId: string, title: string) => {
    if (isNovelDeletionPending || deletionInFlightRef.current) {
      return
    }

    if (!window.confirm(t('library.deleteConfirm', { title }))) {
      return
    }

    deletionInFlightRef.current = true
    setDeletingNovelId(novelId)
    setNovelDeletionPending(true)
    const transaction = beginNovelDeletion(novelId)
    if (!transaction) {
      setNovelDeletionPending(false)
      setDeletingNovelId(null)
      deletionInFlightRef.current = false
      return
    }
    try {
      const outcome = await deleteNovelFromBackend(novelId)
      if (outcome.status === 'committed') {
        reconcileNovelDeletion(outcome.result.activeNovelId)
        await loadLibrarySummaries().catch(() => undefined)
        setLibraryNotice({ variant: 'success', message: t('library.deleted', { title }) })
      } else if (outcome.status === 'rejected') {
        rollbackNovelDeletion(transaction)
        setLibraryNotice({ variant: 'error', message: t('library.deleteFailed', { title }) })
      } else {
        try {
          const reconciliation = await reconcileNovelDeletionFromBackend(transaction)
          await loadLibrarySummaries().catch(() => undefined)
          setLibraryNotice({
            variant: reconciliation === 'present' ? 'warning' : 'success',
            message: t(reconciliation === 'present' ? 'library.deleteFailedAuthoritative' : 'library.deleted', { title }),
          })
        } catch {
          await loadLibrarySummaries().catch(() => undefined)
          setLibraryNotice({ variant: 'warning', message: t('library.deleteReconcileFailed', { title }) })
        }
      }
    } finally {
      setNovelDeletionPending(false)
      setDeletingNovelId(null)
      deletionInFlightRef.current = false
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col items-end gap-3">
        {backendLoadError || librarySummariesError ? (
          <div className="w-full max-w-xl rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {t('library.restoreError', { message: toUserFacingWorkspaceError(backendLoadError || librarySummariesError, locale) })}
          </div>
        ) : !librarySummariesLoaded ? (
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300">
            {t('library.restoreLoading')}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isImporting}
          className="rounded-2xl border border-indigo-400/20 bg-indigo-500/90 px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_30px_rgba(99,102,241,0.35)] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {importFeedback.status === 'uploading'
            ? t('library.uploading')
            : importFeedback.status === 'processing'
              ? t('library.processing')
              : t('library.importButton')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleImportTxt(file)
            event.target.value = ''
          }}
        />
        {importFeedback.status === 'uploading' ? (
          <Notice variant="info" title={t('library.uploadProgress')} className="w-full max-w-xl">
            <div className="flex items-center justify-between gap-3 text-xs text-sky-100/70">
              <span>{t('library.uploadingFilePercent', { name: importFeedback.fileName, percent: importFeedback.percent })}</span>
              <span>{importFeedback.percent}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={t('library.uploadProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={importFeedback.percent}
              className="mt-3 h-2 overflow-hidden rounded-full bg-sky-950/40"
            >
              <div
                className="h-full rounded-full bg-sky-300 transition-all"
                style={{ width: `${importFeedback.percent}%` }}
              />
            </div>
          </Notice>
        ) : importFeedback.status === 'processing' ? (
          <Notice variant="info" title={t('library.serverProcessing')} className="w-full max-w-xl">
            <div className="flex items-center gap-2">
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              <span>{t('library.uploadCompleteProcessing', { name: importFeedback.fileName })}</span>
            </div>
          </Notice>
        ) : importFeedback.status === 'success' ? (
          <Notice variant="success" title={t('library.importResult')} className="w-full max-w-xl">
            {importFeedback.message}
          </Notice>
        ) : importFeedback.status === 'error' ? (
          <Notice variant="error" title={t('library.importFailed')} className="w-full max-w-xl">
            {importFeedback.message}
          </Notice>
        ) : null}
        {libraryNotice ? (
          <Notice variant={libraryNotice.variant} className="w-full max-w-xl">
            {libraryNotice.message}
          </Notice>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {novels.map((novel) => (
          <ProjectCard
            key={novel.id}
            novel={novel}
            onOpen={() => {
              void openNovel(novel.id)
            }}
            onDelete={() => {
              void handleDeleteNovel(novel.id, novel.title)
            }}
            opening={openingNovelId === novel.id}
            deleting={isNovelDeletionPending || deletingNovelId === novel.id}
          />
        ))}
      </div>
    </>
  )
}
