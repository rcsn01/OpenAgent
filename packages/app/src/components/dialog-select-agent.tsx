import { Dialog } from "@openagent-ai/ui/dialog"
import { List } from "@openagent-ai/ui/list"
import { useDialog } from "@openagent-ai/ui/context/dialog"
import { createMemo } from "solid-js"
import { useLocal } from "@/context/local"

export function DialogSelectAgent() {
  const dialog = useDialog()
  const local = useLocal()

  const items = createMemo(() => local.agent.list().map((item) => ({ name: item.name })))

  return (
    <Dialog title="Select agent">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search agents", autofocus: true }}
        emptyMessage="No agents available."
        key={(item) => item.name}
        items={items}
        current={items().find((item) => item.name === local.agent.current()?.name)}
        filterKeys={["name"]}
        onSelect={(item) => {
          if (!item) return
          local.agent.set(item.name)
          dialog.close()
        }}
      >
        {(item) => <div class="w-full truncate">{item.name}</div>}
      </List>
    </Dialog>
  )
}
