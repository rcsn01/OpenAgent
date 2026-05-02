import type { AssistantMessage, Part, Provider, UserMessage } from "./v2/client.js"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  providers?: Provider[]
}

export type TranscriptSession = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type TranscriptMessage = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

function titlecase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function modelName(
  providers: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
) {
  if (!providers) return modelID
  const list = Array.isArray(providers) ? providers : [...providers.values()]
  const provider = list.find((item) => item.id === providerID)
  const model = provider?.models[modelID]
  return model?.name ?? modelID
}

export function formatTranscript(session: TranscriptSession, messages: TranscriptMessage[], options: TranscriptOptions) {
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const message of messages) {
    transcript += formatMessage(message.info, message.parts, options)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(
  message: UserMessage | AssistantMessage,
  parts: Part[],
  options: TranscriptOptions,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
) {
  let result = ""

  if (message.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(message, options.assistantMetadata, providers ?? options.providers)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(
  message: AssistantMessage,
  includeMetadata: boolean,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
) {
  if (!includeMetadata) return `## Assistant\n\n`

  const duration =
    message.time.completed && message.time.created
      ? `${((message.time.completed - message.time.created) / 1000).toFixed(1)}s`
      : ""
  const model = modelName(providers, message.providerID, message.modelID)
  return `## Assistant (${titlecase(message.agent)} · ${model}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions) {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (!options.thinking) return ""
    return `_Thinking:_\n\n${part.text}\n\n`
  }

  if (part.type !== "tool") return ""

  let result = `**Tool: ${part.tool}**\n`
  if (options.toolDetails && part.state.input) {
    result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
  }
  if (options.toolDetails && part.state.status === "completed" && part.state.output) {
    result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
  }
  if (options.toolDetails && part.state.status === "error" && part.state.error) {
    result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`
  }
  return `${result}\n`
}
