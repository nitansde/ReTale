"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Globe,
  GitBranch,
  LoaderCircle,
  MessageCircleMore,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  Settings2,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react'
import { useNovelStore } from '@/store/novel-store'
import { cn, countChineseFriendlyWords, htmlToPlainText, plainTextToHtml } from '@/lib/utils'
import type { Chapter, CharacterRelation, OutlineType, WorldEntryType } from '@/lib/types'

type ActionMode = 'rewrite' | 'roleplay' | 'expand'

type FloatingPosition = {
  top: number
  left: number
}

type RoleplayTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type GenerationState = {
  loading: boolean
  result: string
  error: string
}

type RewriteApiCandidate = {
  title: string
  summary: string
  content: string
}

type RewriteFlowState = {
  loading: boolean
  error: string
  provider: string
  candidates: RewriteApiCandidate[]
  selectedIndex: number
}

type ContextPreviewBlock = {
  id: string
  label: string
  enabled: boolean
  priority: 'highest' | 'high' | 'medium'
  content: string
}

type ContextPreviewData = {
  chapterNo: number
  snapshotStatus: string
  selectedLineStart: number | null
  selectedLineEnd: number | null
  warnings: string[]
  blocks: ContextPreviewBlock[]
}

type KnowledgeRebuildStatus = {
  jobId: string
  novelId: string
  status: string
  progress: number
  currentStep: string | null
  createdAt: string
  updatedAt: string
  etaMinutes: number | null
}

type OllamaModelOption = {
  id: string
  label: string
  family?: string
  parameterSize?: string
  quantization?: string
}

const OUTLINE_TYPE_LABELS: Record<OutlineType, string> = {
  main: '主线',
  side: '支线',
  foreshadow: '伏笔',
  conflict: '冲突',
  climax: '高潮',
}

const WORLD_TYPE_LABELS: Record<WorldEntryType, string> = {
  location: '地点',
  scene: '场景',
  organization: '组织',
  rule: '规则',
  item: '物件',
  history: '历史',
}

const RELATION_STRENGTH_LABELS: Record<CharacterRelation['strength'], string> = {
  weak: '弱',
  medium: '中',
  strong: '强',
}

const RELATION_STATUS_LABELS: Record<CharacterRelation['status'], string> = {
  active: '进行中',
  strained: '紧张',
  hidden: '隐藏',
  resolved: '已解决',
}

const ACTION_META: Record<ActionMode, { label: string; title: string; description: string; icon: typeof Wand2 }> = {
  rewrite: {
    label: '魔改',
    title: '魔改 · 全章重写',
    description: '围绕选中片段与额外要求，产出一个完整章节重写版本。',
    icon: Wand2,
  },
  roleplay: {
    label: '角色扮演',
    title: '角色扮演 · 剧情推进',
    description: '像聊天一样输入角色台词或行动，让故事围绕当前选区继续推进。',
    icon: MessageCircleMore,
  },
  expand: {
    label: '智能扩写',
    title: '智能扩写 · 保留剧情',
    description: '不改变既有剧情走向，只增强描述、氛围、动作与感官细节。',
    icon: Sparkles,
  },
}

const CHAPTER_PAGE_SIZE = 80

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

function extractSelection(root: HTMLElement | null) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !root) return null
  const range = selection.getRangeAt(0)
  const text = selection.toString().trim()
  if (!text) return null
  const common = range.commonAncestorContainer
  const isInside = root.contains(common.nodeType === Node.TEXT_NODE ? common.parentNode : common)
  if (!isInside) return null
  const rect = range.getBoundingClientRect()
  return {
    text,
    rect,
  }
}

function replaceFirstSelection(chapterText: string, selectionText: string, replacement: string) {
  const index = chapterText.indexOf(selectionText)
  if (index < 0) return replacement
  return `${chapterText.slice(0, index)}${replacement}${chapterText.slice(index + selectionText.length)}`
}

function buildRoleplayReply(input: string, selectionText: string, chapterTitle: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return [
    `【${chapterTitle} · 剧情推进】`,
    `你刚才的行动/台词：${trimmed}`,
    `围绕选中片段“${selectionText.slice(0, 80)}${selectionText.length > 80 ? '…' : ''}”，故事继续向前推进。`,
    '角色的回应会更贴近当前场景气氛，并把新的互动自然接到章节里。',
  ].join('\n')
}

async function callContextPreviewApi(payload: Record<string, unknown>): Promise<{ ok: boolean; preview?: ContextPreviewData; error?: string }> {
  const response = await fetch('/api/context-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response.json()
}

async function streamRewriteApi(
  payload: Record<string, unknown>,
  handlers: {
    onChunk: (chunk: string) => void
    onError: (message: string) => void
  }
) {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true }),
  })

  if (!response.ok) {
    const text = await response.text()
    handlers.onError(text || 'Streaming request failed')
    return
  }

  if (!response.body) {
    handlers.onError('Streaming response body is empty')
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    if (chunk) handlers.onChunk(chunk)
  }
}

export function SelectionNovelStudio() {
  const router = useRouter()
  const loadFromBackend = useNovelStore((state) => state.loadFromBackend)
  const saveToBackend = useNovelStore((state) => state.saveToBackend)
  const backendLoaded = useNovelStore((state) => state.backendLoaded)
  const currentNovelId = useNovelStore((state) => state.currentNovelId)
  const localNovels = useNovelStore((state) => state.localNovels)
  const localVolumes = useNovelStore((state) => state.localVolumes)
  const localChapters = useNovelStore((state) => state.localChapters)
  const currentChapterId = useNovelStore((state) => state.currentChapterId)
  const setCurrentChapterId = useNovelStore((state) => state.setCurrentChapterId)
  const updateChapterContent = useNovelStore((state) => state.updateChapterContent)
  const createNewChapter = useNovelStore((state) => state.createNewChapter)
  const deleteChapter = useNovelStore((state) => state.deleteChapter)
  const deleteNovel = useNovelStore((state) => state.deleteNovel)
  const aiSettings = useNovelStore((state) => state.aiSettings)
  const setAISettingsField = useNovelStore((state) => state.setAISettingsField)
  const saveAISettings = useNovelStore((state) => state.saveAISettings)
  const rebuildStoryKnowledge = useNovelStore((state) => state.rebuildStoryKnowledge)
  const refreshKnowledgeProjection = useNovelStore((state) => state.refreshKnowledgeProjection)
  const localCharacters = useNovelStore((state) => state.localCharacters)
  const localCharacterRelations = useNovelStore((state) => state.localCharacterRelations)
  const localWorldEntries = useNovelStore((state) => state.localWorldEntries)
  const localTimelineEvents = useNovelStore((state) => state.localTimelineEvents)
  const localOutlines = useNovelStore((state) => state.localOutlines)
  const autosaveSignature = useNovelStore((state) =>
    JSON.stringify({
      currentNovelId: state.currentNovelId,
      currentChapterId: state.currentChapterId,
      currentTab: state.currentTab,
      helperTab: state.helperTab,
      expandedVolumeIds: state.expandedVolumeIds,
      localNovels: state.localNovels,
      localVolumes: state.localVolumes,
      localChapters: state.localChapters,
      localOutlines: state.localOutlines,
      localCharacters: state.localCharacters,
      localCharacterRelations: state.localCharacterRelations,
      localWorldEntries: state.localWorldEntries,
      localTimelineEvents: state.localTimelineEvents,
      rewriteCandidates: state.rewriteCandidates,
      rewriteHistory: state.rewriteHistory,
      trajectories: state.trajectories,
      rewriteMode: state.rewriteMode,
      rewriteTone: state.rewriteTone,
      rewriteOutput: state.rewriteOutput,
      rewriteScope: state.rewriteScope,
      selectionText: state.selectionText,
      selectedParagraphIndex: state.selectedParagraphIndex,
      thinkingLevel: state.thinkingLevel,
      autoContinue: state.autoContinue,
      keepCanon: state.keepCanon,
      promptText: state.promptText,
      selectedPresetId: state.selectedPresetId,
      presets: state.presets,
      constraints: state.constraints,
      focusMode: state.focusMode,
    })
  )

  const [leftPanelOpen, setLeftPanelOpen] = useState(false)
  const [selectionText, setSelectionText] = useState('')
  const [lockedSelectionText, setLockedSelectionText] = useState('')
  const [toolbarPos, setToolbarPos] = useState<FloatingPosition | null>(null)
  const [activeMode, setActiveMode] = useState<ActionMode | null>(null)
  const [rewritePrompt, setRewritePrompt] = useState('保留核心剧情，围绕选中部分做更大胆、更有戏剧张力的整章重写。')
  const [expandPrompt, setExpandPrompt] = useState('不改变剧情和信息顺序，只补足环境、动作、心理和感官描写。')
  const [rewriteState, setRewriteState] = useState<GenerationState>({ loading: false, result: '', error: '' })
  const [expandState, setExpandState] = useState<GenerationState>({ loading: false, result: '', error: '' })
  const [rewriteFlow, setRewriteFlow] = useState<RewriteFlowState>({
    loading: false,
    error: '',
    provider: '',
    candidates: [],
    selectedIndex: 0,
  })
  const [contextPreview, setContextPreview] = useState<ContextPreviewData | null>(null)
  const [contextPreviewLoading, setContextPreviewLoading] = useState(false)
  const [contextPreviewError, setContextPreviewError] = useState('')
  const [disabledContextBlockIds, setDisabledContextBlockIds] = useState<string[]>([])
  const [roleplayInput, setRoleplayInput] = useState('')
  const [roleplayDraft, setRoleplayDraft] = useState('')
  const [roleplayTurns, setRoleplayTurns] = useState<RoleplayTurn[]>([])
  const [copied, setCopied] = useState<'rewrite' | 'expand' | 'roleplay' | null>(null)
  const [toast, setToast] = useState('')
  const [chapterListState, setChapterListState] = useState<Record<string, number>>({})
  const [refTab, setRefTab] = useState<'characters' | 'relations' | 'outline' | 'world' | 'timeline'>('characters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [knowledgeRebuilding, setKnowledgeRebuilding] = useState(false)
  const [knowledgeRebuildStatus, setKnowledgeRebuildStatus] = useState<KnowledgeRebuildStatus | null>(null)
  const [ollamaTextModels, setOllamaTextModels] = useState<OllamaModelOption[]>([])
  const [ollamaEmbeddingModels, setOllamaEmbeddingModels] = useState<OllamaModelOption[]>([])
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false)
  const [ollamaModelsError, setOllamaModelsError] = useState('')
  const [editState, setEditState] = useState<{
    type: 'char' | 'outline' | 'world' | 'relation' | 'timeline' | null
    id: string | null
    form: Record<string, string>
  }>({ type: null, id: null, form: {} })
  const knowledgePanelReadOnly = true

  const editorRef = useRef<HTMLDivElement | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydratedRef = useRef(false)
  const lastActiveKnowledgeJobIdRef = useRef<string | null>(null)

  useEffect(() => {
    loadFromBackend().catch(() => undefined)
  }, [loadFromBackend])

  useEffect(() => {
    if (backendLoaded && !currentNovelId) {
      router.push('/library')
    }
  }, [backendLoaded, currentNovelId, router])

  useEffect(() => {
    if (!backendLoaded) return
    if (!hydratedRef.current) {
      hydratedRef.current = true
      return
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      saveToBackend().catch(() => undefined)
    }, 700)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [autosaveSignature, backendLoaded, saveToBackend])

  useEffect(() => {
    if (!currentNovelId) {
      setKnowledgeRebuildStatus(null)
      lastActiveKnowledgeJobIdRef.current = null
      return
    }

    let cancelled = false

    const syncRebuildStatus = async () => {
      try {
        const response = await fetch(`/api/knowledge-view?novelId=${encodeURIComponent(currentNovelId)}`, { cache: 'no-store' })
        const data = (await response.json()) as {
          ok?: boolean
          knowledgeRebuildStatus?: KnowledgeRebuildStatus | null
        }

        if (cancelled || !response.ok || !data.ok) return

        const nextStatus = data.knowledgeRebuildStatus ?? null
        const hadActiveJob = Boolean(lastActiveKnowledgeJobIdRef.current)

        setKnowledgeRebuildStatus(nextStatus)

        if (nextStatus?.jobId) {
          lastActiveKnowledgeJobIdRef.current = nextStatus.jobId
          return
        }

        if (hadActiveJob) {
          lastActiveKnowledgeJobIdRef.current = null
          await refreshKnowledgeProjection(currentNovelId)
          if (!cancelled) {
            setToast('知识视图已更新')
            window.setTimeout(() => setToast(''), 1800)
          }
        }
      } catch {
      }
    }

    void syncRebuildStatus()
    const timer = window.setInterval(() => {
      void syncRebuildStatus()
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [currentNovelId, refreshKnowledgeProjection])

  useEffect(() => {
    if (!settingsOpen) return
    void loadOllamaModels(aiSettings?.ollamaBaseUrl)
  }, [settingsOpen])

  const novelVolumes = useMemo(
    () => localVolumes.filter((volume) => volume.novelId === currentNovelId).slice().sort((a, b) => a.order - b.order),
    [localVolumes, currentNovelId]
  )
  const currentNovelMeta = useMemo(
    () => localNovels.find((novel) => novel.id === currentNovelId) ?? null,
    [localNovels, currentNovelId]
  )

  const sortedChapters = useMemo(
    () => localChapters.filter((chapter) => chapter.novelId === currentNovelId).slice().sort((a, b) => a.order - b.order),
    [localChapters, currentNovelId]
  )

  const currentChapter = useMemo(
    () => sortedChapters.find((chapter) => chapter.id === currentChapterId) ?? sortedChapters[0],
    [sortedChapters, currentChapterId]
  )

  const chapterListLimit = chapterListState[currentNovelId] ?? CHAPTER_PAGE_SIZE

  const chapterIndex = useMemo(
    () => (currentChapter ? sortedChapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1),
    [currentChapter, sortedChapters]
  )

  const chapterListTarget = useMemo(() => {
    if (chapterListLimit > CHAPTER_PAGE_SIZE) return chapterListLimit
    if (chapterIndex < 0) return CHAPTER_PAGE_SIZE
    if (chapterIndex >= CHAPTER_PAGE_SIZE - 10) {
      return Math.min(sortedChapters.length, Math.max(CHAPTER_PAGE_SIZE, chapterIndex + 20))
    }
    return CHAPTER_PAGE_SIZE
  }, [chapterIndex, chapterListLimit, sortedChapters.length])

  const chapterText = currentChapter ? htmlToPlainText(currentChapter.content) : ''
  const knowledgeRebuildEtaMinutes = useMemo(() => {
    return knowledgeRebuildStatus?.etaMinutes ?? null
  }, [knowledgeRebuildStatus])

  const editor = useEditor({
    extensions: [StarterKit],
    content: currentChapter?.content ?? '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'px-5 py-6 sm:px-8 sm:py-8 font-[family:var(--font-noto-serif-sc)] text-[1.05rem] leading-9 text-zinc-200 outline-none min-h-[62vh]',
      },
    },
    onUpdate({ editor }) {
      if (currentChapter) {
        updateChapterContent(currentChapter.id, editor.getHTML())
      }
    },
  })

  useEffect(() => {
    if (editor && currentChapter && editor.getHTML() !== currentChapter.content) {
      editor.commands.setContent(currentChapter.content, { emitUpdate: false })
    }
  }, [editor, currentChapter])

  useEffect(() => {
    if (editor) {
      editorRef.current = editor.view.dom as HTMLDivElement
    }
  }, [editor])

  const currentNovelCharacters = localCharacters.filter((item) => item.novelId === currentNovelId)
  const currentNovelCharacterRelations = localCharacterRelations.filter((item) => item.novelId === currentNovelId)
  const currentNovelWorldEntries = localWorldEntries.filter((item) => item.novelId === currentNovelId)
  const currentNovelOutlines = localOutlines.filter((item) => item.novelId === currentNovelId)
  const currentNovelTimelineEvents = localTimelineEvents
    .filter((item) => item.novelId === currentNovelId)
    .slice()
    .sort((a, b) => a.order - b.order)

  useEffect(() => {
    const handler = () => {
      const selection = extractSelection(editorRef.current)
      if (!selection) {
        if (activeMode) {
          setToolbarPos(null)
          return
        }
        setSelectionText('')
        setToolbarPos(null)
        return
      }
      setSelectionText(selection.text)
      setToolbarPos({
        top: window.scrollY + selection.rect.top - 56,
        left: window.scrollX + selection.rect.left + selection.rect.width / 2,
      })
    }

    document.addEventListener('selectionchange', handler)
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      document.removeEventListener('selectionchange', handler)
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [activeMode])

  const resetContextForChapter = (chapter: Chapter) => {
    const nextText = htmlToPlainText(chapter.content)
    setRoleplayTurns([])
    setRoleplayDraft(nextText)
    setSelectionText('')
    setLockedSelectionText('')
    setContextPreview(null)
    setContextPreviewError('')
    setDisabledContextBlockIds([])
    setToolbarPos(null)
    setActiveMode(null)
  }

  const closePanel = () => {
    setActiveMode(null)
    setLockedSelectionText('')
    setContextPreview(null)
    setContextPreviewError('')
    setDisabledContextBlockIds([])
    setRewriteState((current) => ({ ...current, error: '' }))
    setExpandState((current) => ({ ...current, error: '' }))
  }

  const selectedRewriteCandidate = rewriteFlow.candidates[rewriteFlow.selectedIndex]
  const rewriteProvider = aiSettings?.rewriteProvider ?? 'openai-compatible'
  const hasRealModel = Boolean(aiSettings?.configured && aiSettings?.apiKey && aiSettings?.model)
  const providerLabel = rewriteProvider === 'ollama'
    ? `${aiSettings?.ollamaRewriteModel || 'Ollama 自动选择'} · 本地`
    : hasRealModel
      ? `${aiSettings?.model} · 已连接`
      : 'Fallback 模式'

  const getInstructionForMode = (mode: ActionMode) => {
    if (mode === 'rewrite') return rewritePrompt
    if (mode === 'expand') return expandPrompt
    return roleplayInput.trim() || '围绕当前选区继续推进剧情。'
  }

  const loadContextPreview = async (mode: ActionMode, instructionOverride?: string) => {
    if (!currentChapter) return null
    const targetSelection = (lockedSelectionText || selectionText).trim()
    if (!targetSelection) return null

    setContextPreviewLoading(true)
    setContextPreviewError('')
    try {
      const data = await callContextPreviewApi({
        novelId: currentNovelId,
        chapterId: currentChapter.id,
        selectedText: targetSelection,
        operationType: mode,
        userInstruction: instructionOverride ?? getInstructionForMode(mode),
      })

      if (!data.ok || !data.preview) {
        throw new Error(data.error || '上下文预览生成失败')
      }

      setContextPreview(data.preview)
      setDisabledContextBlockIds([])
      return data.preview
    } catch (error) {
      setContextPreview(null)
      setContextPreviewError(error instanceof Error ? error.message : '上下文预览生成失败')
      return null
    } finally {
      setContextPreviewLoading(false)
    }
  }

  const openActionMode = (mode: ActionMode) => {
    const nextSelection = selectionText.trim()
    if (!nextSelection) return
    setLockedSelectionText(nextSelection)
    setToolbarPos(null)
    setContextPreview(null)
    setContextPreviewError('')
    setDisabledContextBlockIds([])
    if (mode === 'rewrite') {
      setRewriteFlow({
        loading: false,
        error: '',
        provider: '',
        candidates: [],
        selectedIndex: 0,
      })
    }
    setActiveMode(mode)
    window.setTimeout(() => {
      void loadContextPreview(mode)
    }, 0)
  }

  const copyText = async (mode: 'rewrite' | 'expand' | 'roleplay', text: string) => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(mode)
    window.setTimeout(() => setCopied(null), 1500)
  }

  const applyFullChapter = (text: string) => {
    if (!currentChapter || !text.trim()) return
    updateChapterContent(currentChapter.id, plainTextToHtml(text.trim()))
    if (editorRef.current) {
      editorRef.current.innerText = text.trim()
    }
    setToast('已应用到正文')
    window.setTimeout(() => setToast(''), 1800)
    closePanel()
  }

  const insertRoleplayIntoChapter = () => {
    const text = roleplayDraft.trim()
    if (!text) return
    applyFullChapter(text)
  }

  const saveSettings = async () => {
    await saveAISettings()
    setSettingsOpen(false)
  }

  const loadOllamaModels = async (baseUrl?: string) => {
    setOllamaModelsLoading(true)
    setOllamaModelsError('')
    try {
      const query = baseUrl?.trim() ? `?baseUrl=${encodeURIComponent(baseUrl.trim())}` : ''
      const [textResponse, embeddingResponse] = await Promise.all([
        fetch(`/api/settings/ai/ollama-models${query}${query ? '&' : '?'}purpose=text`, { cache: 'no-store' }),
        fetch(`/api/settings/ai/ollama-models${query}${query ? '&' : '?'}purpose=embedding`, { cache: 'no-store' }),
      ])
      const textData = (await textResponse.json()) as {
        ok?: boolean
        error?: string
        models?: OllamaModelOption[]
      }
      const embeddingData = (await embeddingResponse.json()) as {
        ok?: boolean
        error?: string
        models?: OllamaModelOption[]
      }

      if (!textResponse.ok || !textData.ok) {
        throw new Error(textData.error || '无法读取本地 Ollama 文本模型')
      }

      if (!embeddingResponse.ok || !embeddingData.ok) {
        throw new Error(embeddingData.error || '无法读取本地 Ollama embedding 模型')
      }

      setOllamaTextModels(textData.models ?? [])
      setOllamaEmbeddingModels(embeddingData.models ?? [])
    } catch (error) {
      setOllamaTextModels([])
      setOllamaEmbeddingModels([])
      setOllamaModelsError(error instanceof Error ? error.message : '无法读取本地 Ollama 模型')
    } finally {
      setOllamaModelsLoading(false)
    }
  }

  const handleDeleteChapter = async (chapter: Chapter) => {
    const branchCount = localChapters.filter((item) => item.parentChapterId === chapter.id).length
    const prompt = chapter.parentChapterId
      ? `确认删除章节《${chapter.title}》吗？`
      : branchCount > 0
        ? `确认删除章节《${chapter.title}》及其 ${branchCount} 个分支吗？`
        : `确认删除章节《${chapter.title}》吗？`

    if (!window.confirm(prompt)) {
      return
    }

    deleteChapter(chapter.id)
    try {
      await saveToBackend()
      setToast(`已删除《${chapter.title}》`)
      window.setTimeout(() => setToast(''), 1800)
    } catch {
      await loadFromBackend()
      setToast(`删除《${chapter.title}》失败，已恢复本地状态。`)
      window.setTimeout(() => setToast(''), 2400)
    }
  }

  const handleDeleteNovel = async () => {
    if (!currentNovelId) return

    const title = currentNovelMeta?.title ?? '当前小说'
    if (!window.confirm(`确认删除小说《${title}》吗？这会同时删除全部章节和本地知识数据。`)) {
      return
    }

    deleteNovel(currentNovelId)
    try {
      await saveToBackend()
      setToast(`已删除《${title}》`)
      window.setTimeout(() => setToast(''), 1800)
    } catch {
      await loadFromBackend()
      setToast(`删除《${title}》失败，已恢复本地状态。`)
      window.setTimeout(() => setToast(''), 2400)
    }
  }

  const handleRebuildKnowledge = async () => {
    if (!currentNovelId || knowledgeRebuilding) return
    setKnowledgeRebuilding(true)
    try {
      await rebuildStoryKnowledge(currentNovelId)
      setToast('知识视图已刷新')
      window.setTimeout(() => setToast(''), 1800)
    } catch {
      setToast('知识视图重建失败')
      window.setTimeout(() => setToast(''), 2200)
    } finally {
      setKnowledgeRebuilding(false)
    }
  }

  const handleRewrite = async () => {
    const targetSelection = lockedSelectionText.trim() || selectionText.trim()
    if (!currentChapter || !targetSelection) return
    setRewriteState({ loading: true, result: '', error: '' })
    setRewriteFlow((current) => ({ ...current, loading: true, error: '', provider: 'context-stream', candidates: [], selectedIndex: 0 }))
    try {
      await loadContextPreview('rewrite', rewritePrompt)
      let streamed = ''
      await streamRewriteApi(
        {
          novelId: currentNovelId,
          chapterId: currentChapter.id,
          selectedText: targetSelection,
          sourceText: chapterText,
          operationType: 'rewrite',
          userInstruction: rewritePrompt,
          disabledBlockIds: disabledContextBlockIds,
          scope: 'chapter',
          mode: 'heavy',
          tone: 'dramatic',
        },
        {
          onChunk: (chunk) => {
            streamed += chunk
            setRewriteState({ loading: true, result: streamed, error: '' })
          },
          onError: (message) => {
            throw new Error(message)
          },
        }
      )

      const finalText = streamed.trim()
      setRewriteState({ loading: false, result: finalText, error: finalText ? '' : 'No result returned.' })
      setRewriteFlow({
        loading: false,
        error: finalText ? '' : 'No result returned.',
        provider: 'context-stream',
        candidates: finalText
          ? [
              {
                title: '流式版本',
                summary: '基于章节快照与证据装配生成。',
                content: finalText,
              },
            ]
          : [],
        selectedIndex: 0,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rewrite failed.'
      setRewriteState({ loading: false, result: '', error: message })
      setRewriteFlow({ loading: false, error: message, provider: '', candidates: [], selectedIndex: 0 })
    }
  }

  const handleExpand = async () => {
    const targetSelection = lockedSelectionText.trim() || selectionText.trim()
    if (!currentChapter || !targetSelection) return
    setExpandState({ loading: true, result: '', error: '' })
    try {
      await loadContextPreview('expand', expandPrompt)
      let streamed = ''
      await streamRewriteApi(
        {
          novelId: currentNovelId,
          chapterId: currentChapter.id,
          selectedText: targetSelection,
          sourceText: chapterText,
          operationType: 'expand',
          userInstruction: expandPrompt,
          disabledBlockIds: disabledContextBlockIds,
          scope: 'chapter',
          mode: 'medium',
          tone: 'cinematic',
        },
        {
          onChunk: (chunk) => {
            streamed += chunk
            setExpandState({ loading: true, result: streamed, error: '' })
          },
          onError: (message) => {
            throw new Error(message)
          },
        }
      )
      const result = streamed.trim()
      setExpandState({ loading: false, result, error: result ? '' : 'No result returned.' })
    } catch (error) {
      setExpandState({ loading: false, result: '', error: error instanceof Error ? error.message : 'Expand failed.' })
    }
  }

  const handleRoleplayTurn = async () => {
    const targetSelection = lockedSelectionText.trim() || selectionText.trim()
    if (!currentChapter || !targetSelection || !roleplayInput.trim()) return
    const userTurn: RoleplayTurn = { id: uid('rp-user'), role: 'user', content: roleplayInput.trim() }
    const baseline = roleplayDraft.trim() || chapterText
    setRoleplayTurns((current) => [...current, userTurn])
    setRoleplayInput('')

    try {
      const fallbackReply = buildRoleplayReply(userTurn.content, targetSelection, currentChapter.title)
      await loadContextPreview('roleplay', userTurn.content)
      let streamed = ''
      await streamRewriteApi(
        {
          novelId: currentNovelId,
          chapterId: currentChapter.id,
          selectedText: targetSelection,
          sourceText: baseline,
          operationType: 'roleplay',
          userInstruction: userTurn.content,
          disabledBlockIds: disabledContextBlockIds,
          scope: 'chapter',
          mode: 'continue',
          tone: 'dramatic',
        },
        {
          onChunk: (chunk) => {
            streamed += chunk
            setRoleplayDraft(streamed)
          },
          onError: (message) => {
            throw new Error(message)
          },
        }
      )
      const generatedText = streamed.trim()
      const nextDraft = generatedText || replaceFirstSelection(baseline, targetSelection, `${targetSelection}\n\n${fallbackReply}`)
      setRoleplayDraft(nextDraft)
      setRoleplayTurns((current) => [
        ...current,
        {
          id: uid('rp-assistant'),
          role: 'assistant',
          content: generatedText ? '已根据这轮角色扮演推进出新的章节草稿。你可以继续对话，或直接应用到正文。' : fallbackReply,
        },
      ])
    } catch {
      const fallbackReply = buildRoleplayReply(userTurn.content, targetSelection, currentChapter.title)
      const nextDraft = replaceFirstSelection(baseline, targetSelection, `${targetSelection}\n\n${fallbackReply}`)
      setRoleplayDraft(nextDraft)
      setRoleplayTurns((current) => [
        ...current,
        { id: uid('rp-assistant'), role: 'assistant', content: fallbackReply },
      ])
    }
  }

  if (!currentChapter) {
    return <main className="min-h-screen bg-[#0a0c12] text-zinc-100" />
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.12),_transparent_30%),#0a0c12] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-3 pb-10 pt-3 sm:px-5 lg:px-6">
        <header className="sticky top-0 z-30 mb-4 rounded-[28px] border border-white/10 bg-[#0d1017]/92 px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/library" className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-zinc-300 transition hover:bg-white/[0.08]">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <button
                onClick={() => setLeftPanelOpen((current) => !current)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08] lg:hidden"
              >
                章节
              </button>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Selection-first novel flow</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">{currentChapter.title}</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">{countChineseFriendlyWords(chapterText).toLocaleString()} 字</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">{currentChapter.status}</span>
              <button
                onClick={() => {
                  void handleDeleteNovel()
                }}
                className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-rose-100 transition hover:bg-rose-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除小说
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 transition hover:bg-white/[0.08]"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {providerLabel}
              </button>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_420px]">
          <aside
            className={cn(
              'fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[320px] overflow-y-auto border-r border-white/10 bg-[#0d1017] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.5)] transition lg:static lg:w-auto lg:max-w-none lg:rounded-[30px] lg:border lg:bg-[#11141d] lg:shadow-[0_24px_70px_rgba(0,0,0,0.3)]',
              leftPanelOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            )}
          >
            <div className="mb-4 flex items-center justify-between lg:block">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Novel</p>
                <h2 className="mt-1 text-lg font-semibold text-zinc-100">章节导航</h2>
              </div>
              <button onClick={() => setLeftPanelOpen(false)} className="rounded-2xl border border-white/10 p-2 text-zinc-300 lg:hidden">
                <X className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() => {
                createNewChapter()
                setLeftPanelOpen(false)
              }}
              className="mb-4 w-full rounded-2xl bg-violet-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-400"
            >
              + 新建章节
            </button>

            <div className="space-y-3">
              {novelVolumes.map((volume) => {
                const chaptersInVolume = sortedChapters.filter((chapter) => chapter.volumeId === volume.id && !chapter.parentChapterId)
                const visibleChapters = chaptersInVolume.slice(0, chapterListTarget)
                const hiddenCount = Math.max(0, chaptersInVolume.length - visibleChapters.length)
                return (
                  <section key={volume.id} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-2 text-left">
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{volume.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">{chaptersInVolume.length} 章</p>
                      </div>
                      <ChevronDown className="h-4 w-4 text-zinc-500" />
                    </div>
                    <div className="mt-2 space-y-2">
                      {visibleChapters.map((chapter) => {
                        const branches = sortedChapters.filter((item) => item.parentChapterId === chapter.id)
                        return (
                          <div key={chapter.id} className="space-y-2">
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => {
                                  setCurrentChapterId(chapter.id)
                                  resetContextForChapter(chapter)
                                  setLeftPanelOpen(false)
                                }}
                                className={cn(
                                  'flex-1 rounded-[22px] border px-3 py-3 text-left transition',
                                  currentChapter.id === chapter.id
                                    ? 'border-violet-400/30 bg-violet-500/12'
                                    : 'border-white/8 bg-black/20 hover:bg-white/[0.06]'
                                )}
                              >
                                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Chapter {chapter.order}</p>
                                <p className="mt-1 text-sm font-medium text-zinc-100">{chapter.title}</p>
                                <p className="mt-2 text-xs text-zinc-500">{chapter.wordCount} 字 · {chapter.updatedAt}</p>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDeleteChapter(chapter)
                                }}
                                className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 text-rose-200 transition hover:bg-rose-500/20"
                                aria-label={`删除章节 ${chapter.title}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            {branches.length ? (
                              <div className="ml-3 border-l border-white/10 pl-3">
                                {branches.map((branch) => (
                                  <div key={branch.id} className="mt-2 flex items-start gap-2">
                                    <button
                                      onClick={() => {
                                        setCurrentChapterId(branch.id)
                                        resetContextForChapter(branch)
                                        setLeftPanelOpen(false)
                                      }}
                                      className={cn(
                                        'flex-1 rounded-2xl border px-3 py-3 text-left transition',
                                        currentChapter.id === branch.id
                                          ? 'border-fuchsia-400/30 bg-fuchsia-500/12'
                                          : 'border-white/8 bg-black/20 hover:bg-white/[0.06]'
                                      )}
                                    >
                                      <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Branch {branch.branchLabel ?? 'B'}</p>
                                      <p className="mt-1 text-sm font-medium text-zinc-100">{branch.title}</p>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleDeleteChapter(branch)
                                      }}
                                      className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 text-rose-200 transition hover:bg-rose-500/20"
                                      aria-label={`删除章节 ${branch.title}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {hiddenCount > 0 ? (
                        <button
                          onClick={() =>
                            setChapterListState((current) => ({
                              ...current,
                              [currentNovelId]: Math.min(chaptersInVolume.length, (current[currentNovelId] ?? CHAPTER_PAGE_SIZE) + CHAPTER_PAGE_SIZE),
                            }))
                          }
                          className="w-full rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06]"
                        >
                          显示更多章节（剩余 {hiddenCount} 章）
                        </button>
                      ) : null}
                    </div>
                  </section>
                )
              })}
            </div>
          </aside>

          <section className="min-w-0 rounded-[30px] border border-white/10 bg-[#11141d] shadow-[0_28px_90px_rgba(0,0,0,0.35)]">
            <div className="border-b border-white/8 px-5 py-4 sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Chapter body first</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">{currentChapter.title}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                    先选章节，再在正文里直接选中想处理的文本。选区上方会弹出浮动入口，展开三种模式：魔改、角色扮演、智能扩写。
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-zinc-400">
                  <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-violet-300" /> 当前选区：{(lockedSelectionText || selectionText) ? `${(lockedSelectionText || selectionText).slice(0, 24)}${(lockedSelectionText || selectionText).length > 24 ? '…' : ''}` : '未选择'}</div>
                </div>
              </div>
            </div>

            <div className="px-4 py-4 sm:px-7 sm:py-6">
              <div className="min-h-[62vh] rounded-[28px] border border-white/8 bg-[#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <EditorContent editor={editor} />
              </div>
            </div>
          </section>

          <aside className="rounded-[30px] border border-white/10 bg-[#11141d] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.35)] sm:p-5">
            <div className="mb-4 rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/70">Primary actions</p>
                <button
                  onClick={() => {
                    void handleRebuildKnowledge()
                  }}
                  disabled={knowledgeRebuilding}
                  className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {knowledgeRebuilding ? '重建中…' : '重建知识视图'}
                </button>
              </div>
              {knowledgeRebuildStatus ? (
                <div className="mt-3 rounded-2xl border border-violet-300/15 bg-black/20 px-3 py-3 text-xs text-zinc-300">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span>本地知识图谱重建中</span>
                    <span>{Math.max(0, Math.min(100, Math.round((knowledgeRebuildStatus.progress ?? 0) * 100)))}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-violet-400 transition-all"
                      style={{ width: `${Math.max(6, Math.min(100, Math.round((knowledgeRebuildStatus.progress ?? 0) * 100)))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-zinc-400">
                    {knowledgeRebuildStatus.currentStep || '正在准备知识重建…'}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                    预估剩余：{knowledgeRebuildEtaMinutes ? `约 ${knowledgeRebuildEtaMinutes} 分钟` : '计算中'}
                  </p>
                </div>
              ) : null}
              <p className="mt-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-400">
                右侧内容现在来自 SQLite 知识库投影，当前阶段先保持只读，避免把本地临时编辑误认为已写回 authoritative KB。
              </p>
              <div className="mt-3 grid gap-2">
                {(['rewrite', 'roleplay', 'expand'] as ActionMode[]).map((mode) => {
                  const meta = ACTION_META[mode]
                  const Icon = meta.icon
                  return (
                    <button
                      key={mode}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (!selectionText.trim()) return
                        openActionMode(mode)
                      }}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
                        activeMode === mode
                          ? 'border-violet-300/30 bg-white/[0.08]'
                          : 'border-white/8 bg-black/20 hover:bg-white/[0.06]',
                        !selectionText.trim() && 'cursor-not-allowed opacity-50'
                      )}
                    >
                      <div className="rounded-xl bg-white/10 p-2 text-violet-200"><Icon className="h-4 w-4" /></div>
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{meta.label}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">{meta.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">人物 {currentNovelCharacters.length}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">关系 {currentNovelCharacterRelations.length}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">设定 {currentNovelWorldEntries.length}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">时间线 {currentNovelTimelineEvents.length}</div>
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-black/30 p-1 mb-4">
              {([
                'characters',
                'relations',
                'outline',
                'world',
                'timeline',
              ] as const).map((tab) => {
                const tabMeta = {
                  characters: { label: '人物', icon: Users },
                  relations: { label: '关系', icon: GitBranch },
                  outline: { label: '大纲', icon: ScrollText },
                  world: { label: '设定', icon: Globe },
                  timeline: { label: '时间线', icon: ScrollText },
                }[tab]
                const TabIcon = tabMeta.icon
                return (
                  <button
                    key={tab}
                    onClick={() => { setRefTab(tab); setEditState({ type: null, id: null, form: {} }) }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition justify-center',
                      refTab === tab ? 'bg-white/10 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                    )}
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    {tabMeta.label}
                  </button>
                )
              })}
            </div>

            <div className="overflow-y-auto max-h-[calc(100vh-28rem)] space-y-2">
              {refTab === 'characters' && (
                <>
                  {currentNovelCharacters.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无人物投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelCharacters.map((char) => {
                    const isEditing = editState.type === 'char' && editState.id === char.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={char.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.name ?? ''} onChange={(e) => setF('name', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="姓名" />
                            <input value={ef.role ?? ''} onChange={(e) => setF('role', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="角色" />
                            <input value={ef.goal ?? ''} onChange={(e) => setF('goal', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="目标" />
                            <input value={ef.trait ?? ''} onChange={(e) => setF('trait', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="性格" />
                            <textarea value={ef.note ?? ''} onChange={(e) => setF('note', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="备注" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateCharacter(char.id, { name: ef.name ?? '', role: ef.role ?? '', goal: ef.goal ?? '', trait: ef.trait ?? '', note: ef.note ?? '' })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div>
                                <p className="text-sm font-medium text-zinc-100">{char.name}</p>
                                <p className="text-xs text-violet-300">{char.role}</p>
                              </div>
                              {!knowledgePanelReadOnly ? (
                                <div className="flex gap-1">
                                  <button onClick={() => setEditState({ type: 'char', id: char.id, form: { name: char.name, role: char.role, goal: char.goal, trait: char.trait, note: char.note } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => { useNovelStore.getState().deleteCharacter(char.id) }} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              ) : null}
                            </div>
                            <div className="space-y-1 text-xs leading-5 text-zinc-400">
                              <p><span className="text-zinc-500">目标</span> {char.goal}</p>
                              <p><span className="text-zinc-500">性格</span> {char.trait}</p>
                              {char.note && <p className="line-clamp-2"><span className="text-zinc-500">备注</span> {char.note}</p>}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly ? (
                    <button onClick={() => setEditState({ type: 'char', id: '__new__', form: { name: '', role: '', goal: '', trait: '', note: '' } })} className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]">
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加人物
                    </button>
                  ) : null}
                  {!knowledgePanelReadOnly && editState.type === 'char' && editState.id === '__new__' && (
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                      <input value={editState.form.name ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, name: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="姓名" />
                      <input value={editState.form.role ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, role: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="角色" />
                      <input value={editState.form.goal ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, goal: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="目标" />
                      <input value={editState.form.trait ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, trait: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="性格" />
                      <textarea value={editState.form.note ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, note: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="备注" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          useNovelStore.getState().addCharacter(currentNovelId, { name: editState.form.name ?? '', role: editState.form.role ?? '', goal: editState.form.goal ?? '', trait: editState.form.trait ?? '', note: editState.form.note ?? '' })
                          setEditState({ type: null, id: null, form: {} })
                        }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">创建</button>
                        <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {refTab === 'relations' && (
                <>
                  {currentNovelCharacterRelations.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无人物关系投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelCharacterRelations.map((relation) => {
                    const fromCharacter = currentNovelCharacters.find((item) => item.id === relation.fromCharacterId)
                    const toCharacter = currentNovelCharacters.find((item) => item.id === relation.toCharacterId)
                    const isEditing = editState.type === 'relation' && editState.id === relation.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={relation.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <select value={ef.fromCharacterId ?? relation.fromCharacterId} onChange={(e) => setF('fromCharacterId', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                                {currentNovelCharacters.map((char) => <option key={char.id} value={char.id}>{char.name}</option>)}
                              </select>
                              <select value={ef.toCharacterId ?? relation.toCharacterId} onChange={(e) => setF('toCharacterId', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                                {currentNovelCharacters.map((char) => <option key={char.id} value={char.id}>{char.name}</option>)}
                              </select>
                            </div>
                            <input value={ef.label ?? relation.label} onChange={(e) => setF('label', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="关系标签" />
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <select value={ef.strength ?? relation.strength} onChange={(e) => setF('strength', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                                <option value="weak">弱</option>
                                <option value="medium">中</option>
                                <option value="strong">强</option>
                              </select>
                              <select value={ef.status ?? relation.status} onChange={(e) => setF('status', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                                <option value="active">进行中</option>
                                <option value="strained">紧张</option>
                                <option value="hidden">隐藏</option>
                                <option value="resolved">已解决</option>
                              </select>
                            </div>
                            <textarea value={ef.note ?? relation.note} onChange={(e) => setF('note', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="关系备注" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateCharacterRelation(relation.id, {
                                  fromCharacterId: ef.fromCharacterId ?? relation.fromCharacterId,
                                  toCharacterId: ef.toCharacterId ?? relation.toCharacterId,
                                  label: ef.label ?? relation.label,
                                  strength: (ef.strength ?? relation.strength) as 'weak' | 'medium' | 'strong',
                                  status: (ef.status ?? relation.status) as 'active' | 'strained' | 'hidden' | 'resolved',
                                  note: ef.note ?? relation.note,
                                })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-zinc-100">{fromCharacter?.name ?? '未知'} → {toCharacter?.name ?? '未知'}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{relation.label}</span>
                                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">强度 {RELATION_STRENGTH_LABELS[relation.strength]}</span>
                                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{RELATION_STATUS_LABELS[relation.status]}</span>
                                </div>
                              </div>
                              {!knowledgePanelReadOnly ? (
                                <div className="flex gap-1">
                                  <button onClick={() => setEditState({ type: 'relation', id: relation.id, form: { fromCharacterId: relation.fromCharacterId, toCharacterId: relation.toCharacterId, label: relation.label, strength: relation.strength, status: relation.status, note: relation.note } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => useNovelStore.getState().deleteCharacterRelation(relation.id)} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              ) : null}
                            </div>
                            {relation.note ? <p className="mt-3 text-xs leading-6 text-zinc-400">{relation.note}</p> : null}
                            {relation.chapterIds.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {relation.chapterIds.map((chId) => (
                                  <span key={chId} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">{localChapters.find((ch) => ch.id === chId)?.title ?? chId}</span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly && currentNovelCharacters.length >= 2 ? (
                    <button
                      onClick={() => {
                        const [first, second] = currentNovelCharacters
                        useNovelStore.getState().addCharacterRelation(currentNovelId, {
                          fromCharacterId: first.id,
                          toCharacterId: second.id,
                          label: '新关系',
                          strength: 'medium',
                          status: 'active',
                          note: '',
                          chapterIds: currentChapter ? [currentChapter.id] : [],
                        })
                      }}
                      className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                    >
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加关系
                    </button>
                  ) : null}
                </>
              )}

              {refTab === 'outline' && (
                <>
                  {currentNovelOutlines.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无大纲投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelOutlines.map((item) => {
                    const isEditing = editState.type === 'outline' && editState.id === item.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={item.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.title ?? ''} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
                            <select value={ef.type ?? 'main'} onChange={(e) => setF('type', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                              <option value="main">主线</option>
                              <option value="side">支线</option>
                              <option value="foreshadow">伏笔</option>
                              <option value="conflict">冲突</option>
                              <option value="climax">高潮</option>
                            </select>
                            <textarea value={ef.summary ?? ''} onChange={(e) => setF('summary', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="摘要" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateOutlineItem(item.id, { title: ef.title ?? '', type: (ef.type ?? 'main') as OutlineType, summary: ef.summary ?? '' })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500">
                                  {OUTLINE_TYPE_LABELS[item.type]}
                                </span>
                              </div>
                              {!knowledgePanelReadOnly ? (
                                <div className="flex gap-1">
                                  <button onClick={() => setEditState({ type: 'outline', id: item.id, form: { title: item.title, type: item.type, summary: item.summary } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => { useNovelStore.getState().deleteOutlineItem(item.id) }} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              ) : null}
                            </div>
                            <p className="text-xs leading-6 text-zinc-400 line-clamp-3">{item.summary}</p>
                            {item.relatedChapterIds.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.relatedChapterIds.map((chId) => (
                                  <span key={chId} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">{localChapters.find((ch) => ch.id === chId)?.title ?? chId}</span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly ? (
                    <button onClick={() => setEditState({ type: 'outline', id: '__new__', form: { title: '', type: 'main', summary: '' } })} className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]">
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加大纲条目
                    </button>
                  ) : null}
                  {!knowledgePanelReadOnly && editState.type === 'outline' && editState.id === '__new__' && (
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                      <input value={editState.form.title ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
                      <select value={editState.form.type ?? 'main'} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, type: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                        <option value="main">主线</option>
                        <option value="side">支线</option>
                        <option value="foreshadow">伏笔</option>
                        <option value="conflict">冲突</option>
                        <option value="climax">高潮</option>
                      </select>
                      <textarea value={editState.form.summary ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, summary: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="摘要" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          useNovelStore.getState().addOutlineItem(currentNovelId, { title: editState.form.title ?? '', type: (editState.form.type ?? 'main') as OutlineType, summary: editState.form.summary ?? '' })
                          setEditState({ type: null, id: null, form: {} })
                        }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">创建</button>
                        <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {refTab === 'world' && (
                <>
                  {currentNovelWorldEntries.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无设定投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelWorldEntries.map((entry) => {
                    const isEditing = editState.type === 'world' && editState.id === entry.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={entry.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.title ?? ''} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
                            <select value={ef.type ?? 'location'} onChange={(e) => setF('type', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                              <option value="location">地点</option>
                              <option value="scene">场景</option>
                              <option value="organization">组织</option>
                              <option value="rule">规则</option>
                              <option value="item">物件</option>
                              <option value="history">历史</option>
                            </select>
                            <textarea value={ef.content ?? ''} onChange={(e) => setF('content', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="描述" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateWorldEntry(entry.id, { title: ef.title ?? '', type: (ef.type ?? 'location') as WorldEntryType, content: ef.content ?? '' })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-zinc-100">{entry.title}</p>
                                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500">
                                  {WORLD_TYPE_LABELS[entry.type]}
                                </span>
                              </div>
                              {!knowledgePanelReadOnly ? (
                                <div className="flex gap-1">
                                  <button onClick={() => setEditState({ type: 'world', id: entry.id, form: { title: entry.title, type: entry.type, content: entry.content } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => { useNovelStore.getState().deleteWorldEntry(entry.id) }} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              ) : null}
                            </div>
                            <p className="text-xs leading-6 text-zinc-400 line-clamp-3">{entry.content}</p>
                          </>
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly ? (
                    <button onClick={() => setEditState({ type: 'world', id: '__new__', form: { title: '', type: 'location', content: '' } })} className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]">
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加设定条目
                    </button>
                  ) : null}
                  {!knowledgePanelReadOnly && editState.type === 'world' && editState.id === '__new__' && (
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                      <input value={editState.form.title ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
                      <select value={editState.form.type ?? 'location'} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, type: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                        <option value="location">地点</option>
                        <option value="scene">场景</option>
                        <option value="organization">组织</option>
                        <option value="rule">规则</option>
                        <option value="item">物件</option>
                        <option value="history">历史</option>
                      </select>
                      <textarea value={editState.form.content ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, content: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="描述" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          useNovelStore.getState().addWorldEntry(currentNovelId, { title: editState.form.title ?? '', type: (editState.form.type ?? 'location') as WorldEntryType, content: editState.form.content ?? '' })
                          setEditState({ type: null, id: null, form: {} })
                        }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">创建</button>
                        <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {refTab === 'timeline' && (
                <>
                  {currentNovelTimelineEvents.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无时间线投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelTimelineEvents.map((event) => {
                    const isEditing = editState.type === 'timeline' && editState.id === event.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={event.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.title ?? event.title} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="事件标题" />
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <input value={ef.phase ?? event.phase} onChange={(e) => setF('phase', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="阶段" />
                              <input value={ef.worldline ?? event.worldline} onChange={(e) => setF('worldline', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="世界线" />
                            </div>
                            <textarea value={ef.summary ?? event.summary} onChange={(e) => setF('summary', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="事件摘要" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateTimelineEvent(event.id, {
                                  title: ef.title ?? event.title,
                                  phase: ef.phase ?? event.phase,
                                  worldline: ef.worldline ?? event.worldline,
                                  summary: ef.summary ?? event.summary,
                                })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-zinc-100">{event.order}. {event.title}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{event.phase}</span>
                                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{event.worldline}</span>
                                </div>
                              </div>
                              {!knowledgePanelReadOnly ? (
                                <div className="flex gap-1">
                                  <button onClick={() => setEditState({ type: 'timeline', id: event.id, form: { title: event.title, phase: event.phase, worldline: event.worldline, summary: event.summary } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => useNovelStore.getState().deleteTimelineEvent(event.id)} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              ) : null}
                            </div>
                            <p className="mt-3 text-xs leading-6 text-zinc-400">{event.summary}</p>
                            {event.chapterIds.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {event.chapterIds.map((chId) => (
                                  <span key={chId} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">{localChapters.find((ch) => ch.id === chId)?.title ?? chId}</span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly ? (
                    <button
                      onClick={() => useNovelStore.getState().addTimelineEvent(currentNovelId, {
                        title: '新事件',
                        phase: '待定阶段',
                        worldline: '主线',
                        summary: '',
                        order: currentNovelTimelineEvents.length + 1,
                        chapterIds: currentChapter ? [currentChapter.id] : [],
                      })}
                      className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                    >
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加时间线事件
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </aside>
        </div>
      </div>

      {toolbarPos && selectionText && !activeMode ? (
        <div
          className="pointer-events-none fixed z-40"
          style={{ top: Math.max(toolbarPos.top, 12), left: toolbarPos.left, transform: 'translateX(-50%)' }}
        >
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-[#090b10]/96 p-1 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            {(['rewrite', 'roleplay', 'expand'] as ActionMode[]).map((mode) => {
              const meta = ACTION_META[mode]
              const Icon = meta.icon
              return (
                <button
                  key={mode}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    openActionMode(mode)
                  }}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs transition',
                    activeMode === mode ? 'bg-violet-500 text-white' : 'text-zinc-300 hover:bg-white/[0.08]'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed right-4 top-4 z-[80] rounded-2xl border border-emerald-400/20 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-[0_12px_50px_rgba(0,0,0,0.35)]">
          {toast}
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
          <div className="absolute inset-x-0 top-[8vh] mx-auto w-full max-w-2xl rounded-[32px] border border-white/10 bg-[#0d1017] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.5)]" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">AI settings</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-100">模型服务配置</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">这里会同时配置改写模型，以及本地知识图谱重建时使用的 Ollama 模型。</p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="rounded-2xl border border-white/10 p-2 text-zinc-300 hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-6">
              <div className="rounded-[24px] border border-white/10 bg-[#0b0d12] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Rewrite model</p>
                <h4 className="mt-2 text-sm font-medium text-zinc-100">改写模型提供方</h4>
                <p className="mt-1 text-xs leading-5 text-zinc-500">用于魔改、扩写和角色扮演生成。现在可以在 OpenAI-compatible 和本地 Ollama 之间切换。</p>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">Provider</span>
                    <select
                      value={rewriteProvider}
                      onChange={(event) => setAISettingsField('rewriteProvider', event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                    >
                      <option value="openai-compatible">OpenAI-compatible</option>
                      <option value="ollama">Ollama 本地模型</option>
                    </select>
                  </label>

                  {rewriteProvider === 'openai-compatible' ? (
                    <>
                      <label className="block">
                        <span className="mb-2 block text-sm text-zinc-300">Base URL</span>
                        <input
                          value={aiSettings?.baseUrl ?? ''}
                          onChange={(event) => setAISettingsField('baseUrl', event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                          placeholder="https://api.openai.com/v1"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm text-zinc-300">API Key</span>
                        <input
                          value={aiSettings?.apiKey ?? ''}
                          onChange={(event) => setAISettingsField('apiKey', event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                          placeholder="sk-..."
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm text-zinc-300">Model</span>
                        <input
                          value={aiSettings?.model ?? ''}
                          onChange={(event) => setAISettingsField('model', event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                          placeholder="deepseek-v4-flash"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-zinc-400">
                        改写会复用下方配置的 Ollama Base URL，并使用这里单独选择的本地语言模型。
                      </div>
                      <label className="block">
                        <span className="mb-2 block text-sm text-zinc-300">Ollama 改写模型</span>
                        <select
                          value={aiSettings?.ollamaRewriteModel ?? ''}
                          onChange={(event) => setAISettingsField('ollamaRewriteModel', event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                        >
                          <option value="">自动选择首个可用文本模型</option>
                          {ollamaTextModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-[#0b0d12] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Ollama local</p>
                    <h4 className="mt-2 text-sm font-medium text-zinc-100">知识抽取与 RAG 模型</h4>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">保留知识图谱重建语言模型选择，并新增单独的 embedding 模型选项供后续 RAG 使用。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void loadOllamaModels(aiSettings?.ollamaBaseUrl)
                    }}
                    className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06]"
                  >
                    {ollamaModelsLoading ? '刷新中…' : '刷新本地模型'}
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">Ollama Base URL</span>
                    <input
                      value={aiSettings?.ollamaBaseUrl ?? ''}
                      onChange={(event) => setAISettingsField('ollamaBaseUrl', event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                      placeholder="http://127.0.0.1:11434"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">知识抽取模型</span>
                    <select
                      value={aiSettings?.ollamaModel ?? ''}
                      onChange={(event) => setAISettingsField('ollamaModel', event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                    >
                      <option value="">自动选择首个可用文本模型</option>
                      {ollamaTextModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">Embedding 模型</span>
                    <select
                      value={aiSettings?.ollamaEmbeddingModel ?? ''}
                      onChange={(event) => setAISettingsField('ollamaEmbeddingModel', event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                    >
                      <option value="">未指定 embedding 模型</option>
                      {ollamaEmbeddingModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {ollamaModelsError ? <p className="text-sm text-rose-300">{ollamaModelsError}</p> : null}
                  {!ollamaModelsError && !ollamaModelsLoading && ollamaTextModels.length === 0 ? (
                    <p className="text-sm text-zinc-500">当前没有发现可用于文本生成的本地 Ollama 语言模型。</p>
                  ) : null}
                  {!ollamaModelsError && !ollamaModelsLoading && ollamaEmbeddingModels.length === 0 ? (
                    <p className="text-sm text-zinc-500">当前没有发现可用于 embedding 的本地 Ollama 模型。</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-500">当前状态：{providerLabel}</p>
              <div className="flex gap-2">
                <button onClick={() => setSettingsOpen(false)} className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.06]">取消</button>
                <button onClick={saveSettings} className="rounded-2xl bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400">保存设置</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeMode ? (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" onClick={closePanel}>
          <div className="absolute inset-x-0 bottom-0 mx-auto max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-t-[32px] border border-white/10 bg-[#0d1017] p-4 shadow-[0_-20px_80px_rgba(0,0,0,0.5)] sm:bottom-6 sm:rounded-[32px] sm:p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Selected text</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-100">{ACTION_META[activeMode].title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{ACTION_META[activeMode].description}</p>
              </div>
              <button onClick={closePanel} className="rounded-2xl border border-white/10 p-2 text-zinc-300 hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
            </div>

            <div className="mb-4 rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-500">选中片段</p>
              <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{lockedSelectionText || selectionText}</p>
            </div>

            <div className="mb-4 rounded-[24px] border border-amber-400/20 bg-amber-500/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">Context preview</p>
                  <p className="mt-1 text-sm text-zinc-300">只会把当前章节及以前的知识送入生成。你可以临时关闭某些上下文块。</p>
                </div>
                <button
                  type="button"
                  onClick={() => activeMode && void loadContextPreview(activeMode)}
                  className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/[0.06]"
                >
                  刷新上下文
                </button>
              </div>

              {contextPreviewLoading ? <p className="text-sm text-zinc-400">正在装配上下文…</p> : null}
              {contextPreviewError ? <p className="text-sm text-rose-300">{contextPreviewError}</p> : null}

              {contextPreview ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-[11px] text-zinc-400">
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">第 {contextPreview.chapterNo} 章</span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">快照：{contextPreview.snapshotStatus}</span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                      选中行：{contextPreview.selectedLineStart ?? '?'} - {contextPreview.selectedLineEnd ?? '?'}
                    </span>
                  </div>

                  {contextPreview.warnings.length ? (
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      {contextPreview.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-2">
                    {contextPreview.blocks.map((block) => {
                      const enabled = !disabledContextBlockIds.includes(block.id)
                      return (
                        <label key={block.id} className={cn('rounded-2xl border px-3 py-3 text-left transition', enabled ? 'border-amber-300/25 bg-white/[0.04]' : 'border-white/8 bg-black/20 opacity-60')}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-zinc-100">{block.label}</p>
                              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-zinc-500">{block.priority}</p>
                            </div>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(event) => {
                                setDisabledContextBlockIds((current) =>
                                  event.target.checked ? current.filter((item) => item !== block.id) : [...current, block.id]
                                )
                              }}
                              className="mt-1 h-4 w-4 rounded border-white/20 bg-black/20 text-amber-400"
                            />
                          </div>
                          <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs leading-6 text-zinc-400">{block.content}</p>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {activeMode === 'rewrite' ? (
              <div className="space-y-4">
                <div className="rounded-[26px] border border-violet-400/20 bg-violet-500/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200/70">魔改工作台</p>
                      <p className="mt-1 text-sm text-zinc-300">先描述你想怎么改，再生成多个完整章节候选。</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">{rewriteFlow.provider || providerLabel}</span>
                  </div>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">魔改要求</span>
                  <textarea value={rewritePrompt} onChange={(event) => setRewritePrompt(event.target.value)} className="h-28 w-full rounded-[24px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none" placeholder="例如：保留剧情走向，但把这段写得更压迫、更像命运在逼近。" />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button onClick={handleRewrite} disabled={rewriteFlow.loading} className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-60">
                    {rewriteFlow.loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} 生成候选版本
                  </button>
                  <button onClick={() => selectedRewriteCandidate && applyFullChapter(selectedRewriteCandidate.content)} disabled={!selectedRewriteCandidate} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    替换正文
                  </button>
                  <button onClick={() => selectedRewriteCandidate && copyText('rewrite', selectedRewriteCandidate.content)} disabled={!selectedRewriteCandidate} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    {copied === 'rewrite' ? <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" /> 已复制</span> : '复制版本'}
                  </button>
                  <button onClick={() => selectedRewriteCandidate && setRewritePrompt((current) => `${current}\n\n继续在候选版本的基础上增强张力和戏剧性，但保持逻辑自洽。`)} disabled={!selectedRewriteCandidate} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    继续魔改
                  </button>
                </div>

                {rewriteFlow.error ? <p className="text-sm text-rose-300">{rewriteFlow.error}</p> : null}

                <div className="grid gap-3 lg:grid-cols-[0.9fr_1.4fr]">
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">候选版本</p>
                    {rewriteFlow.loading ? (
                      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">正在生成候选版本…</div>
                    ) : rewriteFlow.candidates.length ? (
                      rewriteFlow.candidates.map((candidate, index) => (
                        <button
                          key={`${candidate.title}-${index}`}
                          onClick={() => {
                            setRewriteFlow((current) => ({ ...current, selectedIndex: index }))
                            setRewriteState((current) => ({ ...current, result: candidate.content, error: '' }))
                          }}
                          className={cn(
                            'w-full rounded-[24px] border px-4 py-4 text-left transition',
                            rewriteFlow.selectedIndex === index
                              ? 'border-violet-400/30 bg-violet-500/12'
                              : 'border-white/8 bg-black/20 hover:bg-white/[0.06]'
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-zinc-100">{candidate.title}</p>
                            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">版本 {index + 1}</span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{candidate.summary}</p>
                          <p className="mt-3 line-clamp-4 text-xs leading-6 text-zinc-500">{candidate.content}</p>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">生成后会在这里出现多个候选版本。</div>
                    )}
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">预览结果</p>
                      {selectedRewriteCandidate ? <span className="text-xs text-zinc-500">{selectedRewriteCandidate.title}</span> : null}
                    </div>
                    <p className="min-h-72 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{selectedRewriteCandidate?.content || rewriteState.result || '选择文本并生成后，完整章节候选会显示在这里。'}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {activeMode === 'expand' ? (
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">扩写要求</span>
                  <textarea value={expandPrompt} onChange={(event) => setExpandPrompt(event.target.value)} className="h-28 w-full rounded-[24px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none" />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button onClick={handleExpand} disabled={expandState.loading} className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-400 disabled:opacity-60">
                    {expandState.loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} 生成扩写稿
                  </button>
                  <button onClick={() => applyFullChapter(expandState.result)} disabled={!expandState.result.trim()} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    应用到正文
                  </button>
                  <button onClick={() => copyText('expand', expandState.result)} disabled={!expandState.result.trim()} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    {copied === 'expand' ? <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" /> 已复制</span> : '复制结果'}
                  </button>
                </div>

                {expandState.error ? <p className="text-sm text-rose-300">{expandState.error}</p> : null}

                <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <p className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-500">扩写后的完整章节</p>
                  <p className="min-h-52 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{expandState.result || '扩写结果会出现在这里。'}</p>
                </div>
              </div>
            ) : null}

            {activeMode === 'roleplay' ? (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <p className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-500">角色扮演输入</p>
                  <textarea value={roleplayInput} onChange={(event) => setRoleplayInput(event.target.value)} placeholder="输入角色的台词、动作，或者你想推动的剧情。" className="h-28 w-full rounded-[20px] border border-white/10 bg-[#0f1218] px-4 py-3 text-sm text-zinc-100 outline-none" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={handleRoleplayTurn} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-400">
                      <MessageCircleMore className="h-4 w-4" /> 推进一轮剧情
                    </button>
                    <button onClick={insertRoleplayIntoChapter} disabled={!roleplayDraft.trim()} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                      应用到正文
                    </button>
                    <button onClick={() => copyText('roleplay', roleplayDraft)} disabled={!roleplayDraft.trim()} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                      {copied === 'roleplay' ? <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" /> 已复制</span> : '复制草稿'}
                    </button>
                  </div>
                </div>

                {roleplayTurns.length ? (
                  <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                    <p className="mb-3 text-xs uppercase tracking-[0.16em] text-zinc-500">对话记录</p>
                    <div className="space-y-3">
                      {roleplayTurns.map((turn) => (
                        <div key={turn.id} className={cn('rounded-2xl px-4 py-3 text-sm leading-7', turn.role === 'user' ? 'bg-white/[0.06] text-zinc-200' : 'bg-emerald-500/10 text-emerald-100')}>
                          <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-zinc-500">{turn.role === 'user' ? '你' : '系统'}</p>
                          <p className="whitespace-pre-wrap">{turn.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">推进后的章节草稿</p>
                  </div>
                  <p className="min-h-52 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{roleplayDraft || '新的章节草稿会在这里显示。'}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}
