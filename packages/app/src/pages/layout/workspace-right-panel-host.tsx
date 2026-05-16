import { For, createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { WorkspaceRightPanel } from "@/context/workspace-panels"

const PANEL_TRANSITION_MS = 300

type RenderedPanel = {
  key: number
  panel: WorkspaceRightPanel
  phase: "enter" | "active" | "exit"
}

export function WorkspaceRightPanelHost(props: {
  panel: Accessor<WorkspaceRightPanel | undefined>
  open: Accessor<boolean>
  targetWidth: Accessor<number>
}) {
  let nextKey = 0
  let frame: number | undefined
  let timer: number | undefined
  let wasOpen = props.open()

  const initialPanel = props.panel()
  const [renderedPanels, setRenderedPanels] = createSignal<RenderedPanel[]>(
    initialPanel ? [{ key: nextKey++, panel: initialPanel, phase: "active" }] : [],
  )

  const clearScheduledTransition = () => {
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }

  createEffect(() => {
    const nextPanel = props.panel()
    const nextOpen = props.open()

    untrack(() => {
      clearScheduledTransition()

      if (!nextPanel) {
        setRenderedPanels([])
        wasOpen = false
        return
      }

      const current = renderedPanels().find((item) => item.phase !== "exit")
      const samePanel = current?.panel.kind === nextPanel.kind
      const shouldActivateImmediately = !current || !nextOpen || !wasOpen || samePanel

      if (shouldActivateImmediately) {
        setRenderedPanels([{ key: current?.key ?? nextKey++, panel: nextPanel, phase: "active" }])
        wasOpen = nextOpen
        return
      }

      const outgoing = { ...current, phase: "active" as const }
      const incoming = { key: nextKey++, panel: nextPanel, phase: "enter" as const }

      setRenderedPanels([outgoing, incoming])
      frame = requestAnimationFrame(() => {
        setRenderedPanels([
          { ...outgoing, phase: "exit" },
          { ...incoming, phase: "active" },
        ])
        frame = undefined
      })
      timer = window.setTimeout(() => {
        setRenderedPanels([{ ...incoming, phase: "active" }])
        timer = undefined
      }, PANEL_TRANSITION_MS)
      wasOpen = nextOpen
    })
  })

  onCleanup(clearScheduledTransition)

  return (
    <div
      class="absolute inset-y-0 right-0 min-w-0 overflow-hidden bg-background-base"
      style={{ width: `${props.targetWidth()}px` }}
    >
      <For each={renderedPanels()}>
        {(item) => (
          <div
            data-panel-kind={item.panel.kind}
            aria-hidden={item.phase !== "active"}
            inert={item.phase !== "active"}
            class="absolute inset-0 size-full min-w-0 overflow-hidden bg-background-base transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            classList={{
              "translate-x-full opacity-0 pointer-events-none": item.phase === "enter",
              "translate-x-0 opacity-100": item.phase === "active",
              "-translate-x-full opacity-0 pointer-events-none": item.phase === "exit",
            }}
          >
            {item.panel.content}
          </div>
        )}
      </For>
    </div>
  )
}
