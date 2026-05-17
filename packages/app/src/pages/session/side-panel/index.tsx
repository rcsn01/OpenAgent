import { Suspense, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useWorkspacePanels, type WorkspaceRightPanelKind } from "@/context/workspace-panels"
import type { Sizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionContextTab } from "@/components/session"
import { SessionExtensionsPanel } from "./extensions"
import { SessionReviewPanel } from "./review"
import { SessionSubagentsPanel } from "./subagents"

type SessionRightPanelItem = {
  kind: WorkspaceRightPanelKind
  id: string
  label: string
  render: () => JSX.Element
}

const rightPanelIcon = (kind: WorkspaceRightPanelKind) => {
  if (kind === "extensions") return "mcp"
  if (kind === "subagents") return "branch"
  if (kind === "context") return "pin"
  return "review"
}

const rightPanelHeaderClass = (kind: WorkspaceRightPanelKind) => {
  if (kind === "extensions" || kind === "subagents") return "bg-background-stronger"
  return "bg-background-base"
}

const RightPanelHeader = (props: { item: SessionRightPanelItem }) => (
  <div class="flex h-full min-w-0 items-center gap-2 px-4 text-14-medium text-text-strong">
    <Icon name={rightPanelIcon(props.item.kind)} size="small" class="shrink-0 text-icon-base" />
    <span class="min-w-0 truncate">{props.item.label}</span>
  </div>
)

export function SessionSidePanel(props: {
  sessionID?: string
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  size: Sizing
  targetWidth: () => number
}) {
  const language = useLanguage()
  const layout = useLayout()
  const { view } = useSessionLayout()
  const workspacePanels = useWorkspacePanels()

  const panelOpen = createMemo(
    () =>
      view().reviewPanel.opened() ||
      view().subagents.opened() ||
      view().extensions.opened() ||
      view().context.opened(),
  )

  const contextPanel = createMemo<SessionRightPanelItem>(() => ({
    kind: "context",
    id: "context-panel",
    label: language.t("session.tab.context"),
    render: () => <SessionContextTab />,
  }))
  const extensionsPanel = createMemo<SessionRightPanelItem>(() => ({
    kind: "extensions",
    id: "extensions-panel",
    label: "Extensions",
    render: () => <SessionExtensionsPanel />,
  }))
  const subagentsPanel = createMemo<SessionRightPanelItem>(() => ({
    kind: "subagents",
    id: "subagents-panel",
    label: language.t("session.subagents.title"),
    render: () => <SessionSubagentsPanel sessionID={props.sessionID} />,
  }))
  const reviewPanel = createMemo<SessionRightPanelItem>(() => ({
    kind: "review",
    id: "review-panel",
    label: language.t("session.panel.reviewAndFiles"),
    render: () => (
      <SessionReviewPanel
        canReview={props.canReview}
        diffs={props.diffs}
        diffsReady={props.diffsReady}
        empty={props.empty}
        hasReview={props.hasReview}
        reviewCount={props.reviewCount}
        reviewPanel={props.reviewPanel}
        activeDiff={props.activeDiff}
        focusReviewDiff={props.focusReviewDiff}
        size={props.size}
      />
    ),
  }))
  const activePanel = createMemo<SessionRightPanelItem>(() => {
    switch (layout.sidePanel.active()) {
      case "context":
        return contextPanel()
      case "extensions":
        return extensionsPanel()
      case "subagents":
        return subagentsPanel()
      case "review":
      default:
        return reviewPanel()
    }
  })
  createEffect(() => {
    const panel = activePanel()
    workspacePanels.setRightPanel({
      kind: panel.kind,
      id: panel.id,
      label: panel.label,
      header: <RightPanelHeader item={panel} />,
      headerClass: rightPanelHeaderClass(panel.kind),
      open: panelOpen,
      targetWidth: props.targetWidth,
      content: <Suspense fallback={<div class="size-full bg-background-base" />}>{panel.render()}</Suspense>,
    })
  })

  onCleanup(() => {
    workspacePanels.clearRightPanel()
  })

  return null
}
