import { Dialog } from "@openagent/ui/dialog"
import { List } from "@openagent/ui/list"
import { useDialog } from "@openagent/ui/context/dialog"
import { createMemo } from "solid-js"
import { useLocal } from "@/context/local"

export function DialogSelectVariant() {
  const dialog = useDialog()
  const local = useLocal()

  const items = createMemo(() => [
    { id: "default", label: "Default" },
    ...local.model.variant.list().map((item) => ({ id: item, label: item })),
  ])

  return (
    <Dialog title="Select variant">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search variants", autofocus: true }}
        emptyMessage="No variants available."
        key={(item) => item.id}
        items={items}
        current={items().find((item) => item.id === (local.model.variant.current() ?? "default"))}
        filterKeys={["label"]}
        onSelect={(item) => {
          if (!item) return
          local.model.variant.set(item.id === "default" ? undefined : item.id)
          dialog.close()
        }}
      >
        {(item) => <div class="w-full truncate">{item.label}</div>}
      </List>
    </Dialog>
  )
}
