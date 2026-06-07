import { Button } from "@openagent/ui/button"
import { Dialog } from "@openagent/ui/dialog"
import { Switch } from "@openagent/ui/switch"
import { TextField } from "@openagent/ui/text-field"
import { showToast } from "@openagent/ui/toast"
import { useDialog } from "@openagent/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { createSignal } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"

export function DialogInstallPlugin(props: { directory: string; onInstalled?: () => void | Promise<void> }) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const [spec, setSpec] = createSignal("")
  const [global, setGlobal] = createSignal(false)

  const mutation = useMutation(() => ({
    mutationFn: async () => {
      const value = spec().trim()
      if (!value) throw new Error("Plugin spec is required")
      await globalSDK
        .createClient({ directory: props.directory, throwOnError: true })
        .experimental.plugins.install({
          spec: value,
          global: global(),
        })
      await globalSync.refresh(props.directory)
      await props.onInstalled?.()
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        title: "Plugin installed",
      })
      dialog.close()
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: "Couldn't install plugin",
        description: error instanceof Error ? error.message : String(error),
      })
    },
  }))

  return (
    <Dialog title="Install plugin">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <div class="text-12-medium text-text-weak">Plugin spec</div>
          <TextField
            value={spec()}
            onInput={(event) => setSpec(event.currentTarget.value)}
            placeholder="@scope/plugin or ./plugins/my-plugin"
            autofocus
          />
        </div>

        <label class="flex items-center justify-between gap-3">
          <div class="flex flex-col gap-0.5">
            <div class="text-14-medium text-text-strong">Install globally</div>
            <div class="text-12-regular text-text-weak">Use the shared global config instead of this workspace.</div>
          </div>
          <Switch checked={global()} onChange={setGlobal} />
        </label>

        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            Install
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
