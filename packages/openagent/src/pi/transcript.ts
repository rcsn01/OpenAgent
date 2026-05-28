import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, ImageContent, TextContent, ToolResultMessage } from "@earendil-works/pi-ai"
import { MessageV2 } from "@/session/message-v2"

export interface FromOpenAgentOptions {
  readonly stripMedia?: boolean
  readonly toolOutputMaxChars?: number
}

function dataUrlImage(url: string, mime: string): ImageContent | undefined {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url)
  if (!match) return
  return {
    type: "image",
    mimeType: match[1] || mime,
    data: match[2] ? match[3] : btoa(decodeURIComponent(match[3] ?? "")),
  }
}

function truncateToolOutput(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${omitted} chars]`
}

function userContent(message: MessageV2.WithParts, options?: FromOpenAgentOptions): string | (TextContent | ImageContent)[] {
  const content: (TextContent | ImageContent)[] = []
  for (const part of message.parts) {
    if (part.type === "text" && !part.ignored) content.push({ type: "text", text: part.text })
    if (part.type === "file") {
      const image = !options?.stripMedia && MessageV2.isMedia(part.mime) ? dataUrlImage(part.url, part.mime) : undefined
      if (image) content.push(image)
      else content.push({ type: "text", text: `Attached ${part.mime}: ${part.filename ?? part.url}` })
    }
    if (part.type === "compaction") content.push({ type: "text", text: "What did we do so far?" })
    if (part.type === "subtask") content.push({ type: "text", text: "The following tool was executed by the user" })
  }
  if (content.length === 1 && content[0]?.type === "text") return content[0].text
  return content
}

function assistantMessage(message: MessageV2.WithParts): AssistantMessage {
  const info = message.info as MessageV2.Assistant
  const content: AssistantMessage["content"] = []
  for (const part of message.parts) {
    if (part.type === "reasoning") content.push({ type: "thinking", thinking: part.text })
    if (part.type === "text") content.push({ type: "text", text: part.text })
    if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
      content.push({ type: "toolCall", id: part.callID, name: part.tool, arguments: part.state.input })
    }
  }
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: info.providerID,
    model: info.modelID,
    usage: {
      input: info.tokens.input,
      output: info.tokens.output,
      cacheRead: info.tokens.cache.read,
      cacheWrite: info.tokens.cache.write,
      totalTokens: info.tokens.total ?? info.tokens.input + info.tokens.output,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: info.cost,
      },
    },
    stopReason: info.finish === "tool-calls" ? "toolUse" : info.error ? "error" : "stop",
    errorMessage:
      info.error?.data && "message" in info.error.data && typeof info.error.data.message === "string"
        ? info.error.data.message
        : undefined,
    timestamp: info.time.created,
  }
}

function toolResults(message: MessageV2.WithParts, options?: FromOpenAgentOptions): ToolResultMessage[] {
  const results: ToolResultMessage[] = []
  for (const part of message.parts) {
    if (part.type !== "tool") continue
    if (part.state.status !== "completed" && part.state.status !== "error") continue
    results.push({
      role: "toolResult",
      toolCallId: part.callID,
      toolName: part.tool,
      content: [
        {
          type: "text",
          text:
            part.state.status === "completed"
              ? part.state.time.compacted
                ? "[Old tool result content cleared]"
                : truncateToolOutput(part.state.output, options?.toolOutputMaxChars)
              : part.state.error,
        },
      ],
      details: part.state.status === "completed" ? part.state.metadata : part.state.metadata,
      isError: part.state.status === "error",
      timestamp: part.state.time.end,
    })
  }
  return results
}

export function fromOpenAgentMessage(message: MessageV2.WithParts, options?: FromOpenAgentOptions): AgentMessage[] {
  if (message.info.role === "user") {
    return [
      {
        role: "user",
        content: userContent(message, options),
        timestamp: message.info.time.created,
      },
    ]
  }
  return [assistantMessage(message), ...toolResults(message, options)]
}

export function fromOpenAgentMessages(messages: MessageV2.WithParts[], options?: FromOpenAgentOptions): AgentMessage[] {
  return messages.flatMap((message) => fromOpenAgentMessage(message, options))
}

export * as OpenAgentPiTranscript from "./transcript"
