import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Session } from "@opencode-ai/ui/contracts"
import { createMemo } from "solid-js"

const updatedAt = (session: Session) => session.time.updated ?? session.time.created

export function DialogSessionList(props: {
  sessions: Session[]
  currentID?: string
  title?: string
  placeholder?: string
  subtitle?: (session: Session) => string
  onSelect: (session: Session) => void
}) {
  const dialog = useDialog()

  const items = createMemo(() =>
    props.sessions
      .map((session) => ({
        session,
        id: session.id,
        title: session.title,
        directory: session.directory,
        subtitle: props.subtitle?.(session) ?? session.id,
        updatedAt: updatedAt(session),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  )

  return (
    <Dialog title={props.title ?? "Sessions"}>
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: props.placeholder ?? "Search sessions", autofocus: true }}
        emptyMessage="No sessions found."
        key={(item) => item.id}
        items={items}
        current={items().find((item) => item.session.id === props.currentID)}
        filterKeys={["title", "id", "directory", "subtitle"]}
        onSelect={(item) => {
          if (!item) return
          props.onSelect(item.session)
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-14-medium text-text-strong">{item.title}</div>
              <div class="truncate text-12-regular text-text-weak">{item.subtitle}</div>
            </div>
            <div class="shrink-0 text-12-regular text-text-weak">
              {new Date(item.updatedAt).toLocaleTimeString(undefined, { timeStyle: "short" })}
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
