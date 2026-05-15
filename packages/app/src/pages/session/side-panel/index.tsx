import { Match, Show, Switch, createMemo, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import type { Sizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionContextTab } from "@/components/session"
import { SessionExtensionsPanel } from "./extensions"
import { SessionReviewPanel } from "./review"
import { SessionSubagentsPanel } from "./subagents"

const MIN_SIDE_PANEL_WIDTH = 360

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
  reviewSnap: boolean
  size: Sizing
}) {
  const language = useLanguage()
  const { view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const subagentsOpen = createMemo(() => isDesktop() && view().subagents.opened())
  const extensionsOpen = createMemo(() => isDesktop() && view().extensions.opened())
  const contextOpen = createMemo(() => isDesktop() && view().context.opened())
  const open = createMemo(() => reviewOpen() || subagentsOpen() || extensionsOpen() || contextOpen())
  const activePanelID = createMemo(() => {
    if (contextOpen()) return "context-panel"
    if (extensionsOpen()) return "extensions-panel"
    if (subagentsOpen()) return "subagents-panel"
    return "review-panel"
  })
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (contextOpen()) return "auto"
    return `${MIN_SIDE_PANEL_WIDTH}px`
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id={activePanelID()}
        aria-label={
          contextOpen()
            ? language.t("session.tab.context")
            : extensionsOpen()
            ? "Extensions"
            : subagentsOpen()
              ? language.t("session.subagents.title")
              : language.t("session.panel.reviewAndFiles")
        }
        aria-hidden={!open()}
        inert={!open()}
        class="relative z-20 h-full flex overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
          "flex-1 min-w-0": contextOpen(),
          "shrink-0": !contextOpen(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
        }}
        style={{ width: panelWidth(), "min-width": open() ? `${MIN_SIDE_PANEL_WIDTH}px` : "0px" }}
      >
        <div
          class="relative z-10 size-full flex border-l border-border-weaker-base bg-background-base opacity-100 visible"
          style={{ isolation: "isolate" }}
        >
          <Switch>
            <Match when={contextOpen()}>
              <div class="absolute inset-0 z-50 size-full min-w-0 overflow-hidden bg-background-base">
                <SessionContextTab />
              </div>
            </Match>
            <Match when={extensionsOpen()}>
              <SessionExtensionsPanel />
            </Match>
            <Match when={subagentsOpen()}>
              <SessionSubagentsPanel sessionID={props.sessionID} />
            </Match>
            <Match when={true}>
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
            </Match>
          </Switch>
        </div>
      </aside>
    </Show>
  )
}
