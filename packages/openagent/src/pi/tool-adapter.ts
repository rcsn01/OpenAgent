import { type AgentTool, type AgentToolResult } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Context, Effect, Layer } from "effect"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionID, MessageID } from "@/session/schema"
import type { Agent } from "@/agent/agent"
import type { Permission } from "@/permission"
import { Permission as PermissionService } from "@/permission"
import { EffectBridge } from "@/effect/bridge"

export interface AdaptInput {
  readonly tools: Record<string, Tool.Def> | Tool.Def[]
  readonly sessionID: SessionID
  readonly messageID: MessageID
  readonly agent: Agent.Info
  readonly permission?: Permission.Ruleset
  readonly messages: MessageV2.WithParts[]
}

function textResult(result: Tool.ExecuteResult): AgentToolResult<Tool.ExecuteResult["metadata"]> {
  return {
    content: [{ type: "text", text: result.output }],
    details: {
      title: result.title,
      metadata: result.metadata,
      attachments: result.attachments,
    },
  }
}

function unsafeType(schema: JSONSchema7) {
  return Type.Unsafe(schema as any)
}

export interface Interface {
  readonly adapt: (input: AdaptInput) => Effect.Effect<AgentTool[]>
}

export class Service extends Context.Service<Service, Interface>()("@openagent/PiToolAdapter") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bridge = yield* EffectBridge.make()
    const permission = yield* PermissionService.Service

    const adapt: Interface["adapt"] = Effect.fn("PiToolAdapter.adapt")(function* (input) {
      const defs = Array.isArray(input.tools) ? input.tools : Object.values(input.tools)
      return defs.map(
        (def): AgentTool => ({
          name: def.id,
          label: def.id,
          description: def.description,
          parameters: unsafeType(ToolJsonSchema.fromTool(def)),
          async execute(toolCallId, params, signal) {
            const result = await bridge.promise(
              def.execute(params, {
                sessionID: input.sessionID,
                messageID: input.messageID,
                agent: input.agent.name,
                abort: signal ?? new AbortController().signal,
                callID: toolCallId,
                messages: input.messages,
                metadata(update) {
                  return Effect.void
                },
                ask(request) {
                  return permission
                    .ask({
                      ...request,
                      sessionID: input.sessionID,
                      tool: { messageID: input.messageID, callID: toolCallId },
                      ruleset: PermissionService.merge(input.agent.permission, input.permission ?? []),
                    })
                    .pipe(Effect.orDie)
                },
              }),
            )
            return textResult(result)
          },
        }),
      )
    })

    return Service.of({ adapt })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(PermissionService.defaultLayer))

export * as OpenAgentPiToolAdapter from "./tool-adapter"
