"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProjectCard } from './project-card'
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

export function ProjectGrid() {
  const { t, locale } = useI18n()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const {
    backendLoadError,
    getNovels,
    backendLoaded,
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
  const [isImporting, setIsImporting] = useState(false)
  const [deletingNovelId, setDeletingNovelId] = useState<string | null>(null)
  const [openingNovelId, setOpeningNovelId] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [uploadPercent, setUploadPercent] = useState<number>(0)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'processing'>('idle')
  const deletionInFlightRef = useRef(false)

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
    if (backendLoaded) return
    loadFromBackend().catch(() => undefined)
  }, [backendLoaded, loadFromBackend])

  const openNovel = async (novelId: string, chapterId?: string) => {
    const chapter = selectNovelChapter(novelId, chapterId)

    if (!chapter) {
      setOpeningNovelId(null)
      setImportMessage(t('library.noChapter'))
      return
    }

    setOpeningNovelId(novelId)

    try {
      router.push('/workspace')
      void saveToBackend().catch((error) => {
        console.warn('Failed to persist the newly opened workspace selection in the background.', error)
      })
    } catch {
      setImportMessage(t('library.openFailed'))
      setOpeningNovelId(null)
    }
  }

  const handleImportTxt = async (file: File) => {
    setIsImporting(true)
    setPhase('uploading')
    setUploadPercent(0)
    setImportMessage(t('library.uploadingFile', { name: file.name }))

    try {
      const formData = new FormData()
      formData.append('file', file)

      const data = await new Promise<{ novelId: string; chapterId: string; chapterCount: number }>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/import-txt')

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
            setUploadPercent(percent)
            setImportMessage(t('library.uploadingFilePercent', { name: file.name, percent }))
          }
        }

        xhr.upload.onload = () => {
          setPhase('processing')
          setUploadPercent(100)
          setImportMessage(t('library.uploadCompleteProcessing', { name: file.name }))
        }

        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(json)
            } else {
              reject(new Error(json.error || t('library.importFailed')))
            }
          } catch {
            reject(new Error(t('library.invalidServerResult')))
          }
        }

        xhr.onerror = () => reject(new Error(t('library.uploadFailed')))
        xhr.send(formData)
      })

      setPhase('processing')
      setUploadPercent(100)
      await loadFromBackend()

      if (data.chapterCount <= 120) {
        setImportMessage(t('library.importedAndOpening', { count: data.chapterCount }))
        await openNovel(data.novelId, data.chapterId)
        return
      }

      setImportMessage(t('library.importedRefresh', { count: data.chapterCount }))
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : t('library.importFailed'))
    } finally {
      setIsImporting(false)
      setPhase('idle')
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
        setImportMessage(t('library.deleted', { title }))
      } else if (outcome.status === 'rejected') {
        rollbackNovelDeletion(transaction)
        setImportMessage(t('library.deleteFailed', { title }))
      } else {
        try {
          const reconciliation = await reconcileNovelDeletionFromBackend(transaction)
          setImportMessage(t(reconciliation === 'present' ? 'library.deleteFailedAuthoritative' : 'library.deleted', { title }))
        } catch {
          setImportMessage(t('library.deleteReconcileFailed', { title }))
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
        {backendLoadError ? (
          <div className="w-full max-w-xl rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {t('library.restoreError', { message: toUserFacingWorkspaceError(backendLoadError, locale) })}
          </div>
        ) : !backendLoaded ? (
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
          {isImporting ? (phase === 'uploading' ? t('library.uploading') : t('library.processing')) : t('library.importButton')}
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
        {importMessage ? (
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-zinc-500">
              <span>
                {phase === 'uploading' && isImporting ? t('library.uploadProgress') : phase === 'processing' ? t('library.serverProcessing') : t('library.importResult')}
              </span>
              <span>{phase === 'uploading' ? `${uploadPercent}%` : phase === 'processing' ? t('library.processing') : t('library.completed')}</span>
            </div>
            {(isImporting || uploadPercent > 0) && (
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-indigo-400 transition-all"
                  style={{ width: `${phase === 'processing' ? 100 : uploadPercent}%` }}
                />
              </div>
            )}
            <div>{importMessage}</div>
          </div>
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
