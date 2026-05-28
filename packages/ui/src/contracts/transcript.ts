import type { Message, Part, Provider } from "./index"

export type TranscriptOptions = {
  messages: Message[]
  parts: Record<string, Part[] | undefined>
  providers?: Provider[]
}

export function formatTranscript(options: TranscriptOptions): string
export function formatTranscript(
  messages: Message[],
  parts: Record<string, Part[] | undefined>,
  options?: Partial<TranscriptOptions>,
): string
export function formatTranscript(
  input: TranscriptOptions | Message[],
  parts?: Record<string, Part[] | undefined>,
  options?: Partial<TranscriptOptions>,
) {
  const transcript =
    Array.isArray(input) ?
      {
        ...options,
        messages: input,
        parts: parts ?? {},
      }
    : input
  return transcript.messages
    .map((message) => {
      const messageParts = transcript.parts[message.id] ?? []
      const text = messageParts
        .map((part) => {
          if (typeof part.text === "string") return part.text
          if (typeof part.content === "string") return part.content
          return ""
        })
        .filter(Boolean)
        .join("\n")
      return `${message.role}: ${text}`.trim()
    })
    .join("\n\n")
}
