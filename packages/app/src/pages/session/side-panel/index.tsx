import { Match, Show, Switch, createMemo, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import type { Sizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionExtensionsPanel } from "./extensions"
import { SessionReviewPanel } from "./review"
import { SessionSubagentsPanel } from "./subagents"

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
  const layout = useLayout()
  const language = useLanguage()
  const { view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const subagentsOpen = createMemo(() => isDesktop() && view().subagents.opened())
  const extensionsOpen = createMemo(() => isDesktop() && view().extensions.opened())
  const open = createMemo(() => reviewOpen() || subagentsOpen() || extensionsOpen())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    return `calc(100% - ${layout.session.width()}px)`
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id="review-panel"
        aria-label={
          extensionsOpen()
            ? "Extensions"
            : subagentsOpen()
              ? language.t("session.subagents.title")
              : language.t("session.panel.reviewAndFiles")
        }
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
        }}
        style={{ width: panelWidth() }}
      >
        <div class="size-full flex border-l border-border-weaker-base bg-background-base">
          <Switch>
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
