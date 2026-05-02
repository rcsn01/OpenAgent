import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { createMemo } from "solid-js"

const updatedAt = (session: Session) => session.time.updated ?? session.time.created

export function DialogSessionList(props: {
  sessions: Session[]
  currentID?: string
  onSelect: (session: Session) => void
}) {
  const dialog = useDialog()

  const items = createMemo(() => props.sessions.slice().sort((a, b) => updatedAt(b) - updatedAt(a)))

  return (
    <Dialog title="Sessions">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search sessions", autofocus: true }}
        emptyMessage="No sessions found."
        key={(item) => item.id}
        items={items}
        current={items().find((item) => item.id === props.currentID)}
        filterKeys={["title", "id"]}
        onSelect={(item) => {
          if (!item) return
          props.onSelect(item)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-14-medium text-text-strong">{item.title}</div>
              <div class="truncate text-12-regular text-text-weak">{item.id}</div>
            </div>
            <div class="shrink-0 text-12-regular text-text-weak">
              {new Date(updatedAt(item)).toLocaleTimeString(undefined, { timeStyle: "short" })}
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
