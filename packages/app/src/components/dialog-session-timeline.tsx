import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import type { TextPart, UserMessage } from "@opencode-ai/sdk/v2/client"

type TimelineItem = {
  id: string
  text: string
  time: string
}

function preview(parts: ReturnType<typeof useSync>["data"]["part"][string] | undefined) {
  const part = parts?.find((item): item is TextPart => item.type === "text" && !item.synthetic && !item.ignored)
  return part?.text.replace(/\n/g, " ").trim()
}

export function DialogSessionTimeline(props: {
  sessionID: string
  onSelect: (message: UserMessage) => void
}) {
  const dialog = useDialog()
  const sync = useSync()

  const messages = createMemo(() => {
    const list = sync.data.message[props.sessionID] ?? []
    const items: Array<{ info: UserMessage; item: TimelineItem }> = []
    for (const message of list) {
      if (message.role !== "user") continue
      const text = preview(sync.data.part[message.id])
      if (!text) continue
      items.push({
        info: message,
        item: {
          id: message.id,
          text: text.slice(0, 200),
          time: new Date(message.time.created).toLocaleTimeString(undefined, { timeStyle: "short" }),
        },
      })
    }
    return items.reverse()
  })

  return (
    <Dialog title="Jump to message">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search messages", autofocus: true }}
        emptyMessage="No user messages found."
        key={(item) => item.item.id}
        items={messages}
        filterKeys={["item.text", "item.id"]}
        onSelect={(entry) => {
          if (!entry) return
          props.onSelect(entry.info)
          dialog.close()
        }}
      >
        {(entry) => (
          <div class="w-full flex items-center gap-3">
            <div class="min-w-0 flex-1 truncate">{entry.item.text}</div>
            <div class="shrink-0 text-12-regular text-text-weak">{entry.item.time}</div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
