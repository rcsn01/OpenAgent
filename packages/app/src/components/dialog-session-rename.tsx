import { Button } from "@openagent/ui/button"
import { Dialog } from "@openagent/ui/dialog"
import { TextField } from "@openagent/ui/text-field"
import { showToast } from "@openagent/ui/toast"
import { useDialog } from "@openagent/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { createMemo, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function DialogSessionRename(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const [value, setValue] = createSignal(session()?.title ?? "")

  const mutation = useMutation(() => ({
    mutationFn: (title: string) => sdk.client.session.update({ sessionID: props.sessionID, title }),
    onSuccess: () => {
      sync.set("session", (items) =>
        items.map((item) => (item.id === props.sessionID ? { ...item, title: value().trim() } : item)),
      )
      dialog.close()
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: "Couldn't rename session",
        description: error instanceof Error ? error.message : String(error),
      })
    },
  }))

  const save = () => {
    const next = value().trim()
    if (!next || next === session()?.title) {
      dialog.close()
      return
    }
    mutation.mutate(next)
  }

  return (
    <Dialog title="Rename session">
      <div class="flex flex-col gap-4">
        <TextField value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={mutation.isPending} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
