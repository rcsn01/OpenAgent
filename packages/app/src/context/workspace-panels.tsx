import { createContext, useContext, type Accessor, type JSX } from "solid-js"

export const MIN_WORKSPACE_RIGHT_PANEL_WIDTH = 360
export const WORKSPACE_PANEL_DIVIDER_WIDTH = 1

export type WorkspaceRightPanelKind = "review" | "subagents" | "extensions" | "context"

export type WorkspaceRightPanel = {
  kind: WorkspaceRightPanelKind
  id: string
  label: string
  header?: JSX.Element
  headerClass?: string
  open: Accessor<boolean>
  targetWidth: Accessor<number>
  content: JSX.Element
}

export type WorkspacePanelsContextValue = {
  setRightPanel(panel: WorkspaceRightPanel): void
  clearRightPanel(): void
}

export const WorkspacePanelsContext = createContext<WorkspacePanelsContextValue>()

export function useWorkspacePanels() {
  const ctx = useContext(WorkspacePanelsContext)
  if (!ctx) throw new Error("WorkspacePanelsContext is missing")
  return ctx
}
