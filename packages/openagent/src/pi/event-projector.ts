import type { AgentEvent } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, ToolCall, Usage } from "@earendil-works/pi-ai"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { PartID } from "@/session/schema"
import { SessionEvent } from "@openagent-ai/core/session-event"
import { Context, DateTime, Effect, Layer } from "effect"

export interface ProjectionContext {
  readonly assistant: MessageV2.Assistant
}

type MutableProjection = {
  text?: MessageV2.TextPart
  reasoningByIndex: Record<number, MessageV2.ReasoningPart>
  toolByCallId: Record<string, MessageV2.ToolPart>
}

function usageTokens(usage: Usage): MessageV2.Assistant["tokens"] {
  return {
    total: usage.totalTokens,
    input: usage.input,
    output: usage.output,
    reasoning: 0,
    cache: {
      read: usage.cacheRead,
      write: usage.cacheWrite,
    },
  }
}

function finish(reason: AssistantMessage["stopReason"]): string {
  if (reason === "toolUse") return "tool-calls"
  if (reason === "aborted") return "abort"
  if (reason === "length") return "length"
  if (reason === "error") return "error"
  return "stop"
}

export interface Interface {
  readonly create: (input: ProjectionContext) => Effect.Effect<(event: AgentEvent) => Promise<void>>
}

export class Service extends Context.Service<Service, Interface>()("@openagent/PiEventProjector") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service

    const create: Interface["create"] = Effect.fn("PiEventProjector.create")(function* (input) {
      const state: MutableProjection = { reasoningByIndex: {}, toolByCallId: {} }

      const projectAssistant = Effect.fn("PiEventProjector.assistant")(function* (message: AssistantMessage) {
        input.assistant.cost = message.usage.cost.total
        input.assistant.tokens = usageTokens(message.usage)
        input.assistant.finish = finish(message.stopReason)
        if (message.errorMessage) {
          input.assistant.error = MessageV2.fromError(new Error(message.errorMessage), {
            providerID: input.assistant.providerID,
            aborted: message.stopReason === "aborted",
          })
        }
        input.assistant.time.completed = input.assistant.time.completed ?? Date.now()
        yield* session.updateMessage(input.assistant)
      })

      const ensureText = Effect.fn("PiEventProjector.ensureText")(function* () {
        if (state.text) return state.text
        state.text = yield* session.updatePart({
          id: PartID.ascending(),
          sessionID: input.assistant.sessionID,
          messageID: input.assistant.id,
          type: "text",
          text: "",
          time: { start: Date.now() },
        })
        return state.text
      })

      const ensureReasoning = Effect.fn("PiEventProjector.ensureReasoning")(function* (contentIndex: number) {
        const existing = state.reasoningByIndex[contentIndex]
        if (existing) return existing
        const part: MessageV2.ReasoningPart = yield* session.updatePart({
          id: PartID.ascending(),
          sessionID: input.assistant.sessionID,
          messageID: input.assistant.id,
          type: "reasoning",
          text: "",
          time: { start: Date.now(), end: undefined },
        })
        state.reasoningByIndex[contentIndex] = part
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Reasoning.Started, {
            sessionID: input.assistant.sessionID,
            reasoningID: String(contentIndex),
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        return part
      })

      const ensureTool = Effect.fn("PiEventProjector.ensureTool")(function* (toolCall: ToolCall) {
        const existing = state.toolByCallId[toolCall.id]
        if (existing) return existing
        const part = yield* session.updatePart({
          id: PartID.ascending(),
          sessionID: input.assistant.sessionID,
          messageID: input.assistant.id,
          type: "tool",
          callID: toolCall.id,
          tool: toolCall.name,
          state: {
            status: "running",
            input: toolCall.arguments,
            time: { start: Date.now() },
          },
        })
        state.toolByCallId[toolCall.id] = part
        return part
      })

      return async (event: AgentEvent) => {
        await Effect.runPromise(
          Effect.gen(function* () {
            switch (event.type) {
              case "message_update": {
                const update = event.assistantMessageEvent
                if (update.type === "text_delta") {
                  const part = yield* ensureText()
                  part.text += update.delta
                  yield* session.updatePartDelta({
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    partID: part.id,
                    field: "text",
                    delta: update.delta,
                  })
                }
                if (update.type === "thinking_delta") {
                  const part = yield* ensureReasoning(update.contentIndex)
                  part.text += update.delta
                  yield* session.updatePartDelta({
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    partID: part.id,
                    field: "text",
                    delta: update.delta,
                  })
                }
                if (update.type === "thinking_end") {
                  const part = yield* ensureReasoning(update.contentIndex)
                  part.time.end = Date.now()
                  yield* session.updatePart(part)
                }
                if (update.type === "toolcall_end") {
                  yield* ensureTool(update.toolCall)
                }
                break
              }
              case "tool_execution_start": {
                yield* ensureTool({
                  type: "toolCall",
                  id: event.toolCallId,
                  name: event.toolName,
                  arguments: event.args ?? {},
                })
                break
              }
              case "tool_execution_end": {
                const part = state.toolByCallId[event.toolCallId]
                if (!part || part.state.status !== "running") break
                const output =
                  Array.isArray(event.result?.content) && event.result.content[0]?.type === "text"
                    ? event.result.content.map((item: any) => (item.type === "text" ? item.text : "")).join("\n")
                    : ""
                yield* session.updatePart({
                  ...part,
                  state: event.isError
                    ? {
                        status: "error",
                        input: part.state.input,
                        error: output || "Tool execution failed",
                        metadata: typeof event.result?.details === "object" ? event.result.details : undefined,
                        time: { start: part.state.time.start, end: Date.now() },
                      }
                    : {
                        status: "completed",
                        input: part.state.input,
                        title: event.result?.details?.title ?? event.toolName,
                        output,
                        metadata: event.result?.details?.metadata ?? {},
                        time: { start: part.state.time.start, end: Date.now() },
                        attachments: event.result?.details?.attachments,
                      },
                } as MessageV2.ToolPart)
                break
              }
              case "message_end": {
                if (event.message.role === "assistant") yield* projectAssistant(event.message)
                break
              }
              case "agent_end": {
                input.assistant.time.completed = input.assistant.time.completed ?? Date.now()
                yield* session.updateMessage(input.assistant)
                break
              }
            }
          }),
        )
      }
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export * as OpenAgentPiEventProjector from "./event-projector"
