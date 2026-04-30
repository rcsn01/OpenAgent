import type { Prompt } from "@/context/prompt"
import { clonePromptParts } from "./history"

const needsSeparator = (value: string, transcript: string) => {
  if (!value) return false
  if (!transcript) return false
  if (/\s$/.test(value)) return false
  if (/^[,.;:!?)]/.test(transcript)) return false
  return true
}

export function applyVoiceTranscript(basePrompt: Prompt, transcript: string): Prompt {
  const images = basePrompt.filter((part) => part.type === "image")
  const content = clonePromptParts(basePrompt.filter((part) => part.type !== "image"))
  const nextTranscript = transcript.trim()
  if (!nextTranscript) return [...content, ...images]

  const last = content[content.length - 1]
  if (last?.type === "text") {
    last.content = `${last.content}${needsSeparator(last.content, nextTranscript) ? " " : ""}${nextTranscript}`
  } else {
    content.push({
      type: "text",
      content: nextTranscript,
      start: 0,
      end: nextTranscript.length,
    })
  }

  let position = 0
  const flowed = content.map((part) => {
    if (part.type === "image") return part
    const next = { ...part, start: position, end: position + part.content.length }
    position = next.end
    return next
  })

  return [...flowed, ...images]
}

