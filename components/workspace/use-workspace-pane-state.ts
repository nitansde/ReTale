"use client"

import { useState } from 'react'

export type WorkspaceCenterPaneView = 'body' | 'graph'
export type WorkspaceRefTab = 'characters' | 'relations' | 'outline' | 'world' | 'timeline'

export function useWorkspacePaneState() {
  const [leftPanelOpen, setLeftPanelOpen] = useState(false)
  const [chapterListState, setChapterListState] = useState<Record<string, number>>({})
  const [centerPaneView, setCenterPaneView] = useState<WorkspaceCenterPaneView>('body')
  const [refTab, setRefTab] = useState<WorkspaceRefTab>('characters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDeleteKnowledge, setConfirmDeleteKnowledge] = useState(false)

  return {
    leftPanelOpen,
    setLeftPanelOpen,
    chapterListState,
    setChapterListState,
    centerPaneView,
    setCenterPaneView,
    refTab,
    setRefTab,
    settingsOpen,
    setSettingsOpen,
    confirmDeleteKnowledge,
    setConfirmDeleteKnowledge,
  }
}
