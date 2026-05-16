import { createMediaQuery } from "@solid-primitives/media"
import { createMemo } from "solid-js"

const COLLAPSED_SIDEBAR_WIDTH = 0
const MIN_SESSION_COLUMN_WIDTH = 420
const MIN_SIDE_PANEL_WIDTH = 360

export function useSessionPanelLayout(input: {
  reviewPanelOpened: () => boolean
  subagentsOpened: () => boolean
  extensionsOpened: () => boolean
  contextOpened: () => boolean
  platform: () => "web" | "desktop"
  channel: () => string | undefined
  showFileTreeSetting: () => boolean
  fileTreeOpened: () => boolean
  fileTreeWidth: () => number
  sidebarOpened: () => boolean
  sidebarWidth: () => number
  sessionWidth: () => number
}) {
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const desktopReviewOpen = createMemo(() => isDesktop() && input.reviewPanelOpened())
  const desktopSubagentsOpen = createMemo(() => isDesktop() && input.subagentsOpened())
  const desktopExtensionsOpen = createMemo(() => isDesktop() && input.extensionsOpened())
  const desktopContextOpen = createMemo(() => isDesktop() && input.contextOpened())
  const desktopMainPanelOpen = createMemo(
    () => desktopReviewOpen() || desktopSubagentsOpen() || desktopExtensionsOpen() || desktopContextOpen(),
  )
  const fileTreeShown = createMemo(
    () => input.platform() !== "desktop" || input.channel() !== "beta" || input.showFileTreeSetting(),
  )
  const desktopFileTreeOpen = createMemo(() => desktopReviewOpen() && fileTreeShown() && input.fileTreeOpened())
  const desktopSidePanelOpen = createMemo(() => desktopMainPanelOpen())
  const reviewResizeMax = () => {
    if (typeof window === "undefined") return 1000
    const sidebarWidth = input.sidebarOpened() ? input.sidebarWidth() : COLLAPSED_SIDEBAR_WIDTH
    const fileTreeReserve = desktopFileTreeOpen() ? input.fileTreeWidth() : 0
    const reserve = fileTreeReserve + MIN_SIDE_PANEL_WIDTH
    return Math.max(MIN_SESSION_COLUMN_WIDTH, window.innerWidth - sidebarWidth - reserve)
  }
  const effectiveSessionWidth = createMemo(() => {
    const width = Math.max(MIN_SESSION_COLUMN_WIDTH, input.sessionWidth())
    if (!desktopSidePanelOpen()) return width
    return Math.min(width, reviewResizeMax())
  })
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    return `min(${effectiveSessionWidth()}px, calc(100% - ${MIN_SIDE_PANEL_WIDTH}px))`
  })
  const centered = createMemo(() => isDesktop() && !desktopMainPanelOpen())

  return {
    isDesktop,
    desktopReviewOpen,
    desktopSubagentsOpen,
    desktopExtensionsOpen,
    desktopContextOpen,
    desktopMainPanelOpen,
    desktopFileTreeOpen,
    desktopSidePanelOpen,
    reviewResizeMax,
    effectiveSessionWidth,
    sessionPanelWidth,
    centered,
  }
}
