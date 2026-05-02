import { Dialog } from "@opencode-ai/ui/dialog"
import { StatusPopoverBody } from "./status-popover-body"

export function DialogStatus() {
  return (
    <Dialog title="Status" size="large" fit>
      <div class="flex justify-center">
        <StatusPopoverBody shown={() => true} />
      </div>
    </Dialog>
  )
}
