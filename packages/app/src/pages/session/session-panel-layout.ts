import { createMemo } from "solid-js"
import { MIN_WORKSPACE_RIGHT_PANEL_WIDTH } from "@/context/workspace-panels"

const COLLAPSED_SIDEBAR_WIDTH = 0
const MIN_SESSION_COLUMN_WIDTH = 420

export function useSessionPanelLayout(input: {
  reviewPanelOpened: () => boolean
  contextOpened: () => boolean
  extensionsOpened: () => boolean
  platform: () => "web" | "desktop"
  channel: () => string | undefined
  showFileTreeSetting: () => boolean
  fileTreeOpened: () => boolean
  fileTreeWidth: () => number
  sidebarOpened: () => boolean
  sidebarWidth: () => number
  sessionWidth: () => number
}) {
  const desktopReviewOpen = createMemo(() => input.reviewPanelOpened())
  const desktopRightPanelOpen = createMemo(() => input.reviewPanelOpened() || input.contextOpened() || input.extensionsOpened())
  const fileTreeShown = createMemo(
    () => input.platform() !== "desktop" || input.channel() !== "beta" || input.showFileTreeSetting(),
  )
  const desktopFileTreeOpen = createMemo(() => desktopReviewOpen() && fileTreeShown() && input.fileTreeOpened())
  const reviewResizeMax = () => {
    if (typeof window === "undefined") return 1000
    const sidebarWidth = input.sidebarOpened() ? input.sidebarWidth() : COLLAPSED_SIDEBAR_WIDTH
    const fileTreeReserve = desktopFileTreeOpen() ? input.fileTreeWidth() : 0
    const reserve = fileTreeReserve + MIN_WORKSPACE_RIGHT_PANEL_WIDTH
    return Math.max(MIN_SESSION_COLUMN_WIDTH, window.innerWidth - sidebarWidth - reserve)
  }
  const effectiveSessionWidth = createMemo(() => {
    const width = Math.max(MIN_SESSION_COLUMN_WIDTH, input.sessionWidth())
    if (!desktopRightPanelOpen()) return width
    return Math.min(width, reviewResizeMax())
  })
  const centered = createMemo(() => !desktopRightPanelOpen())

  return {
    desktopReviewOpen,
    desktopRightPanelOpen,
    desktopFileTreeOpen,
    reviewResizeMax,
    effectiveSessionWidth,
    centered,
  }
}
