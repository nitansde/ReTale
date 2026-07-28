"use client"

import { useMemo, useState } from 'react'

export type WorkspaceCenterPaneView = 'body' | 'graph'
export type WorkspaceRefTab = 'characters' | 'organizations' | 'locations' | 'worldbuilding' | 'outline' | 'timeline'

const VALID_WORKSPACE_REF_TABS: WorkspaceRefTab[] = [
  'characters',
  'organizations',
  'locations',
  'worldbuilding',
  'outline',
  'timeline',
]

export function resolveWorkspaceRefTab(value: string | null | undefined): WorkspaceRefTab {
  return VALID_WORKSPACE_REF_TABS.includes(value as WorkspaceRefTab) ? value as WorkspaceRefTab : 'characters'
}

export function useWorkspacePaneState() {
  const [leftPanelOpen, setLeftPanelOpen] = useState(false)
  const [referencePanelOpen, setReferencePanelOpen] = useState(false)
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(false)
  const [chapterListState, setChapterListState] = useState<Record<string, number>>({})
  const [centerPaneView, setCenterPaneView] = useState<WorkspaceCenterPaneView>('body')
  const [rawRefTab, setRawRefTab] = useState<string>('characters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDeleteKnowledge, setConfirmDeleteKnowledge] = useState(false)

  const refTab = useMemo(() => resolveWorkspaceRefTab(rawRefTab), [rawRefTab])

  return {
    leftPanelOpen,
    setLeftPanelOpen,
    referencePanelOpen,
    setReferencePanelOpen,
    knowledgePanelOpen,
    setKnowledgePanelOpen,
    chapterListState,
    setChapterListState,
    centerPaneView,
    setCenterPaneView,
    refTab,
    setRefTab: (tab: WorkspaceRefTab | string) => setRawRefTab(resolveWorkspaceRefTab(tab)),
    settingsOpen,
    setSettingsOpen,
    confirmDeleteKnowledge,
    setConfirmDeleteKnowledge,
  }
}
