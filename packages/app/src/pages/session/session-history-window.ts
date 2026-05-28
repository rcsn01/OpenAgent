import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { UserMessage } from "@openagent-ai/sdk/v2"
import { same } from "@/utils/same"

const emptyUserMessages: UserMessage[] = []

type SessionHistoryWindowInput = {
  sessionID: () => string | undefined
  loaded: () => number
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  userScrolled: () => boolean
  scroller: () => HTMLDivElement | undefined
}

/**
 * Loads older history for the virtualized timeline.
 *
 * The `historyShift` flag is raised while older rows are prepended so virtua
 * can preserve the current viewport from the end of the list.
 */
export function createSessionHistoryWindow(input: SessionHistoryWindowInput) {
  const topLoadThreshold = 200
  const prefetchCooldownMs = 400
  const noGrowthLimit = 2

  const [state, setState] = createStore({
    shift: false,
    loadingUntil: 0,
    noGrowth: 0,
  })

  let shiftFrame: number | undefined

  const clearShift = () => {
    if (shiftFrame !== undefined) cancelAnimationFrame(shiftFrame)
    shiftFrame = requestAnimationFrame(() => {
      shiftFrame = undefined
      setState("shift", false)
    })
  }

  const loadOlder = async (opts?: { prefetch?: boolean }) => {
    const id = input.sessionID()
    if (!id) return
    if (!input.historyMore() || input.historyLoading()) return

    if (opts?.prefetch) {
      const now = Date.now()
      if (state.loadingUntil > now) return
      if (state.noGrowth >= noGrowthLimit) return
      setState("loadingUntil", now + prefetchCooldownMs)
    }

    const beforeVisible = input.visibleUserMessages().length
    let loaded = input.loaded()
    let added = 0
    let growth = 0

    setState("shift", true)
    try {
      while (true) {
        await input.loadMore(id)
        if (input.sessionID() !== id) return

        const nextLoaded = input.loaded()
        const raw = nextLoaded - loaded
        loaded = nextLoaded
        added += raw
        growth = input.visibleUserMessages().length - beforeVisible

        if (growth > 0) break
        if (raw <= 0) break
        if (opts?.prefetch) break
        if (!input.historyMore()) break
      }
    } finally {
      clearShift()
    }

    if (opts?.prefetch) {
      setState("noGrowth", added > 0 ? 0 : state.noGrowth + 1)
    } else if (added > 0 && state.noGrowth) {
      setState("noGrowth", 0)
    }
  }

  const onScrollerScroll = () => {
    if (!input.userScrolled()) return
    const el = input.scroller()
    if (!el) return
    if (el.scrollTop >= topLoadThreshold) return

    void loadOlder({ prefetch: true })
  }

  const renderedUserMessages = createMemo(() => input.visibleUserMessages(), emptyUserMessages, { equals: same })

  onCleanup(() => {
    if (shiftFrame !== undefined) cancelAnimationFrame(shiftFrame)
  })

  return {
    renderedUserMessages,
    historyShift: () => state.shift,
    loadAndReveal: () => loadOlder(),
    onScrollerScroll,
  }
}
