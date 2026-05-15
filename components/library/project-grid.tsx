"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProjectCard } from './project-card'
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
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const {
    backendLoadError,
    getNovels,
    backendLoaded,
    loadFromBackend,
    saveToBackend,
    setCurrentNovelId,
    setCurrentChapterId,
    deleteNovel,
  } = useNovelStore()
  const novels = getNovels()
  const [isImporting, setIsImporting] = useState(false)
  const [deletingNovelId, setDeletingNovelId] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [uploadPercent, setUploadPercent] = useState<number>(0)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'processing'>('idle')

  useEffect(() => {
    if (backendLoaded) return
    loadFromBackend().catch(() => undefined)
  }, [backendLoaded, loadFromBackend])

  const openNovel = (novelId: string, chapterId?: string) => {
    const chapter = resolveOpenNovelChapter(useNovelStore.getState().localChapters, novelId, chapterId)

    if (!chapter) {
      setImportMessage('这个小说当前没有可用章节，请刷新后重试，或重新导入一次。')
      return
    }

    setCurrentNovelId(novelId)
    setCurrentChapterId(chapter.id)
    router.push('/workspace')
  }

  const handleImportTxt = async (file: File) => {
    setIsImporting(true)
    setPhase('uploading')
    setUploadPercent(0)
    setImportMessage(`正在上传 ${file.name} …`)

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
            setImportMessage(`正在上传 ${file.name} … ${percent}%`)
          }
        }

        xhr.upload.onload = () => {
          setPhase('processing')
          setUploadPercent(100)
          setImportMessage(`文件上传完成，服务器正在解析并入库 ${file.name} …`)
        }

        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(json)
            } else {
              reject(new Error(json.error || '导入失败'))
            }
          } catch {
            reject(new Error('服务器返回了无效结果'))
          }
        }

        xhr.onerror = () => reject(new Error('上传失败，请检查本地服务是否正常'))
        xhr.send(formData)
      })

      setPhase('processing')
      setUploadPercent(100)
      await loadFromBackend()

      if (data.chapterCount <= 120) {
        setImportMessage(`上传完成，已导入 ${data.chapterCount} 章，正在进入工作区…`)
        openNovel(data.novelId, data.chapterId)
        return
      }

      setImportMessage(`上传完成，服务器已解析完成：共 ${data.chapterCount} 章。已刷新书库，请从书库卡片进入工作区。`) 
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : '导入失败')
    } finally {
      setIsImporting(false)
      setPhase('idle')
    }
  }

  const handleDeleteNovel = async (novelId: string, title: string) => {
    if (!window.confirm(`确认删除小说《${title}》吗？这会同时删除它的全部章节和本地知识数据。`)) {
      return
    }

    setDeletingNovelId(novelId)
    deleteNovel(novelId)
    try {
      await saveToBackend()
      setImportMessage(`已删除《${title}》`)
    } catch {
      await loadFromBackend()
      setImportMessage(`删除《${title}》失败，已恢复本地状态。`)
    } finally {
      setDeletingNovelId(null)
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col items-end gap-3">
        {backendLoadError ? (
          <div className="w-full max-w-xl rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            读取已保存工作区时遇到问题：{backendLoadError}。你仍然可以继续导入 TXT 进行恢复。
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isImporting}
          className="rounded-2xl border border-indigo-400/20 bg-indigo-500/90 px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_30px_rgba(99,102,241,0.35)] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isImporting ? (phase === 'uploading' ? '上传中…' : '解析中…') : '导入 TXT 小说'}
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
                {phase === 'uploading' && isImporting ? '上传进度' : phase === 'processing' ? '服务器处理' : '导入结果'}
              </span>
              <span>{phase === 'uploading' ? `${uploadPercent}%` : phase === 'processing' ? '处理中' : '完成'}</span>
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
            onOpen={() => openNovel(novel.id)}
            onDelete={() => {
              void handleDeleteNovel(novel.id, novel.title)
            }}
            deleting={deletingNovelId === novel.id}
          />
        ))}
      </div>
    </>
  )
}
