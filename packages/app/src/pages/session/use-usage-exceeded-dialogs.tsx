import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useDialog } from "@openagent/ui/context/dialog"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { DialogUsageExceeded } from "./dialog-usage-exceeded"
import {
  shouldShowUsageExceededDialog,
  usageExceededAction,
  type UsageExceededReason,
  type UsageExceededState,
} from "./usage-exceeded-dialogs"

const defaultState: UsageExceededState = {
  lastSeen: {},
  dontShow: {},
}

export function useUsageExceededDialogs(input: { sessionID: () => string | undefined }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const [store, setStore] = persisted(Persist.global("usage-exceeded-dialogs.v1"), createStore(defaultState))

  const show = (
    action: NonNullable<Extract<SessionStatus, { type: "retry" }>["action"]> & { reason: UsageExceededReason },
  ) => {
    if (!shouldShowUsageExceededDialog(store, action.reason)) return
    setStore("lastSeen", action.reason, Date.now())
    dialog.show(() => (
      <DialogUsageExceeded
        action={action}
        onDontShowAgain={() => {
          setStore("dontShow", action.reason, true)
        }}
      />
    ))
  }

  const unsubscribe = sdk.event.on("session.status", (event) => {
    const active = input.sessionID()
    if (!active || event.properties.sessionID !== active) return

    const status = event.properties.status
    const action = usageExceededAction(status)
    if (!action) return
    show(action)
  })

  onCleanup(unsubscribe)
}
