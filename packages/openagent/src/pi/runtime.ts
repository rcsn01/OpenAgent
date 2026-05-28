import { Agent as PiAgent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import type { ModelMessage } from "ai"
import { Context, Effect, Layer } from "effect"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import type { Permission } from "@/permission"
import type { SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { OpenAgentPiModelRegistry, UnsupportedPiModelError } from "./model-registry"
import { OpenAgentPiToolAdapter } from "./tool-adapter"
import { OpenAgentPiEventProjector } from "./event-projector"
import { OpenAgentPiSessionStorage } from "./session-storage"
import { fromOpenAgentMessages, type FromOpenAgentOptions } from "./transcript"

export type RunResult = "compact" | "stop" | "continue"

export interface RunInput {
  readonly assistantMessage: MessageV2.Assistant
  readonly user: MessageV2.User
  readonly sessionID: SessionID
  readonly parentSessionID?: SessionID
  readonly model: Provider.Model
  readonly agent: Agent.Info
  readonly permission?: Permission.Ruleset
  readonly system: string[]
  readonly messages: MessageV2.WithParts[]
  readonly modelMessages?: ModelMessage[]
  readonly transcriptOptions?: FromOpenAgentOptions
  readonly tools: Record<string, any>
  readonly piTools?: AgentTool[]
}

export interface GenerateTextInput {
  readonly sessionID?: SessionID
  readonly model: Provider.Model
  readonly system?: string[]
  readonly messages?: AgentMessage[]
  readonly prompt: string
}

export interface Interface {
  readonly run: (input: RunInput) => Effect.Effect<RunResult, UnsupportedPiModelError>
  readonly generateText: (input: GenerateTextInput) => Effect.Effect<string, UnsupportedPiModelError>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly wait: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@openagent/PiRuntime") {}

function messageKey(message: AgentMessage) {
  return JSON.stringify({
    role: message.role,
    timestamp: "timestamp" in message ? message.timestamp : undefined,
    content: "content" in message ? message.content : undefined,
    toolCallId: "toolCallId" in message ? message.toolCallId : undefined,
  })
}

function assistantText(message: AssistantMessage | undefined) {
  if (!message) return ""
  return message.content
    .filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const models = yield* OpenAgentPiModelRegistry.Service
    const adapter = yield* OpenAgentPiToolAdapter.Service
    const projector = yield* OpenAgentPiEventProjector.Service
    const running = new Map<SessionID, PiAgent>()

    const cancel: Interface["cancel"] = Effect.fn("PiRuntime.cancel")(function* (sessionID) {
      running.get(sessionID)?.abort()
    })

    const wait: Interface["wait"] = Effect.fn("PiRuntime.wait")(function* (sessionID) {
      const agent = running.get(sessionID)
      if (!agent) return
      yield* Effect.promise(() => agent.waitForIdle())
    })

    const run: Interface["run"] = Effect.fn("PiRuntime.run")(function* (input) {
      const model = yield* models.resolve(input.model)
      const piTools =
        input.piTools ??
        (yield* adapter.adapt({
          tools: input.tools,
          sessionID: input.sessionID,
          messageID: input.assistantMessage.id,
          agent: input.agent,
          permission: input.permission,
          messages: input.messages,
        }))
      const project = yield* projector.create({ assistant: input.assistantMessage })
      const messages = fromOpenAgentMessages(input.messages, input.transcriptOptions).filter((message) => {
        if (message.role !== "assistant") return true
        return message.timestamp !== input.assistantMessage.time.created
      })
      yield* Effect.promise(async () => {
        const storage = new OpenAgentPiSessionStorage(input.sessionID)
        const session = OpenAgentPiSessionStorage.session(input.sessionID, await storage.getMetadata())
        const existing = new Set(
          (await storage.findEntries("message")).map((entry) => messageKey(entry.message as AgentMessage)),
        )
        for (const message of messages) {
          const key = messageKey(message)
          if (existing.has(key)) continue
          await session.appendMessage(message)
          existing.add(key)
        }
      })
      const last = messages.at(-1)
      const agent = new PiAgent({
        initialState: {
          systemPrompt: input.system.filter(Boolean).join("\n"),
          model,
          thinkingLevel: model.reasoning ? "medium" : "off",
          tools: piTools,
          messages: messages as AgentMessage[],
        },
        convertToLlm(messages) {
          return messages.filter(
            (message): message is Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }> =>
              message.role === "user" || message.role === "assistant" || message.role === "toolResult",
          )
        },
        getApiKey(provider) {
          return Effect.runPromise(models.getApiKey(provider))
        },
        toolExecution: "sequential",
        sessionId: input.sessionID,
      })
      agent.subscribe(project)
      running.set(input.sessionID, agent)
      yield* Effect.promise(async () => {
        try {
          if (last?.role === "user" || last?.role === "toolResult") {
            await agent.continue()
          } else {
            await agent.prompt({
              role: "user",
              content: "",
              timestamp: Date.now(),
            })
          }
        } finally {
          running.delete(input.sessionID)
        }
      })
      yield* Effect.promise(async () => {
        const storage = new OpenAgentPiSessionStorage(input.sessionID)
        const session = OpenAgentPiSessionStorage.session(input.sessionID, await storage.getMetadata())
        for (const message of agent.state.messages.slice(messages.length)) {
          await session.appendMessage(message)
        }
      })
      const finish = input.assistantMessage.finish
      if (!finish || finish === "tool-calls" || finish === "unknown") return "continue"
      return "stop"
    })

    const generateText: Interface["generateText"] = Effect.fn("PiRuntime.generateText")(function* (input) {
      const model = yield* models.resolve(input.model)
      const agent = new PiAgent({
        initialState: {
          systemPrompt: input.system?.filter(Boolean).join("\n") ?? "",
          model,
          thinkingLevel: model.reasoning ? "medium" : "off",
          tools: [],
          messages: input.messages ?? [],
        },
        convertToLlm(messages) {
          return messages.filter(
            (message): message is Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }> =>
              message.role === "user" || message.role === "assistant" || message.role === "toolResult",
          )
        },
        getApiKey(provider) {
          return Effect.runPromise(models.getApiKey(provider))
        },
        sessionId: input.sessionID,
        toolExecution: "sequential",
      })
      yield* Effect.promise(() => agent.prompt(input.prompt))
      return assistantText(agent.state.messages.findLast((message) => message.role === "assistant") as AssistantMessage)
    })

    return Service.of({ run, generateText, cancel, wait })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(OpenAgentPiModelRegistry.defaultLayer),
  Layer.provide(OpenAgentPiToolAdapter.defaultLayer),
  Layer.provide(OpenAgentPiEventProjector.defaultLayer),
)

export * as OpenAgentPiRuntime from "./runtime"
