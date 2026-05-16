import { createEffect, on } from "solid-js"

type TabStore = {
  tabs: () => { all: string[]; active?: string }
  setAll: (tabs: string[]) => void
  setActive: (tab: string | undefined) => void
}

type TabHandoffStore = {
  tabs: () => { id: string; dir: string; at: number } | undefined
  clearTabs: () => void
}

export function useSessionTabHandoff(input: {
  sessionID: () => string | undefined
  directory: () => string | undefined
  handoff: TabHandoffStore
  workspaceTabs: () => TabStore
  tabs: () => TabStore
  normalizeTab: (tab: string) => string
  normalizeTabs: (tabs: string[]) => string[]
}) {
  createEffect(
    on(
      input.sessionID,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = input.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          input.handoff.clearTabs()
          return
        }

        if (pending.id !== id) return
        input.handoff.clearTabs()
        if (pending.dir !== (input.directory() ?? "")) return

        const from = input.workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = input.tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = input.normalizeTabs(from.all)
        const active = from.active ? input.normalizeTab(from.active) : undefined
        input.tabs().setAll(all)
        input.tabs().setActive(active && all.includes(active) ? active : all[0])

        input.workspaceTabs().setAll([])
        input.workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )
}
