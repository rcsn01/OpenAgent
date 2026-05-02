import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"

export type SessionExportOptions = {
  filename: string
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export function DialogSessionExport(props: {
  defaultFilename: string
  defaults: Omit<SessionExportOptions, "filename">
  onCopy: (options: SessionExportOptions) => void | Promise<void>
  onExport: (options: SessionExportOptions) => void | Promise<void>
}) {
  const dialog = useDialog()
  const [filename, setFilename] = createSignal(props.defaultFilename)
  const [options, setOptions] = createStore(props.defaults)

  const value = () => ({
    filename: filename().trim() || props.defaultFilename,
    thinking: options.thinking,
    toolDetails: options.toolDetails,
    assistantMetadata: options.assistantMetadata,
  })

  const close = async (action: "copy" | "export") => {
    const next = value()
    if (action === "copy") await props.onCopy(next)
    if (action === "export") await props.onExport(next)
    dialog.close()
  }

  return (
    <Dialog title="Export transcript">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <div class="text-12-medium text-text-weak">Filename</div>
          <TextField value={filename()} onInput={(event) => setFilename(event.currentTarget.value)} autofocus />
        </div>

        <div class="flex flex-col gap-3">
          <label class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
              <div class="text-14-medium text-text-strong">Thinking</div>
              <div class="text-12-regular text-text-weak">Include reasoning summaries in the transcript.</div>
            </div>
            <Switch checked={options.thinking} onChange={(value) => setOptions("thinking", value)} />
          </label>

          <label class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
              <div class="text-14-medium text-text-strong">Tool details</div>
              <div class="text-12-regular text-text-weak">Include tool inputs and outputs.</div>
            </div>
            <Switch checked={options.toolDetails} onChange={(value) => setOptions("toolDetails", value)} />
          </label>

          <label class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
              <div class="text-14-medium text-text-strong">Assistant metadata</div>
              <div class="text-12-regular text-text-weak">Include agent, model, and duration headers.</div>
            </div>
            <Switch
              checked={options.assistantMetadata}
              onChange={(value) => setOptions("assistantMetadata", value)}
            />
          </label>
        </div>

        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => void close("copy")}>
            Copy
          </Button>
          <Button variant="primary" onClick={() => void close("export")}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
