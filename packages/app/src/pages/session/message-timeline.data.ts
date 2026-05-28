import type { UserMessage } from "@opencode-ai/ui/contracts"

export type MessageTimelineRow =
  | {
      type: "load-earlier"
      key: string
    }
  | {
      type: "message"
      key: string
      messageID: string
    }

export function createMessageTimelineRows(input: {
  messages: readonly UserMessage[]
  historyMore: boolean
  previous?: readonly MessageTimelineRow[]
}) {
  const cache = new Map(input.previous?.map((row) => [row.key, row]))
  const rows: MessageTimelineRow[] = []

  if (input.historyMore) {
    rows.push(cache.get("load-earlier") ?? { type: "load-earlier", key: "load-earlier" })
  }

  for (const message of input.messages) {
    const key = `message:${message.id}`
    const cached = cache.get(key)
    rows.push(cached?.type === "message" ? cached : { type: "message", key, messageID: message.id })
  }

  return rows
}
