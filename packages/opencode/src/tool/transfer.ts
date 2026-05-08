import { Agent } from "@/agent/agent"
import { allowedRecipients, isAllowed } from "@/agent/communication"
import { isSpawnableAgent, spawnableAgentError } from "@/agent/spawnable"
import { Config } from "@/config/config"
import type { TaskPromptOps } from "@/session/task-execution"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  recipient_agent: Schema.String.annotate({ description: "The specialist agent that should continue with the user." }),
  reason: Schema.String.annotate({ description: "Brief reason this agent owns the next step." }),
})

type Metadata = {
  recipientAgent: string
  mode: "transfer"
  continuationCreated: boolean
}

export const TransferTool = Tool.define<typeof Parameters, Metadata, Agent.Service | Config.Service>(
  "transfer",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const config = yield* Config.Service

    return {
      description:
        "Transfer the current conversation to another specialist agent. Use this for single-specialist work or when the current specialist receives an out-of-scope request. After calling transfer, stop and let the recipient continue.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const recipients = allowedRecipients(cfg, ctx.agent, "transfer")
          if (!isAllowed(cfg, ctx.agent, params.recipient_agent, "transfer")) {
            const list = recipients.length ? recipients.join(", ") : "none"
            return yield* Effect.fail(
              new Error(`Agent "${ctx.agent}" cannot transfer to "${params.recipient_agent}". Allowed recipients: ${list}.`),
            )
          }

          const recipient = yield* agents.get(params.recipient_agent)
          if (!recipient) return yield* Effect.fail(new Error(`Unknown recipient agent: ${params.recipient_agent}`))
          if (!isSpawnableAgent(recipient)) return yield* Effect.fail(spawnableAgentError(recipient.name))
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          let continuationCreated = false

          if (ops) {
            yield* ops.prompt({
              sessionID: ctx.sessionID,
              agent: recipient.name,
              noReply: true,
              parts: [
                {
                  type: "text",
                  text: [
                    `<agent_transfer from="${ctx.agent}" to="${recipient.name}">`,
                    `reason: ${params.reason}`,
                    "",
                    "You are now the active specialist for this conversation.",
                    "Continue from the prior context and address the user's request directly.",
                    "</agent_transfer>",
                  ].join("\n"),
                },
              ],
            })
            continuationCreated = true
          }

          return {
            title: `transfer to ${recipient.name}`,
            metadata: {
              recipientAgent: recipient.name,
              mode: "transfer" as const,
              continuationCreated,
            },
            output: [
              `<agent_transfer from="${ctx.agent}" to="${recipient.name}">`,
              `reason: ${params.reason}`,
              "",
              continuationCreated
                ? `Transfer accepted. The active continuation is now agent "${recipient.name}". Stop responding as ${ctx.agent}.`
                : `Transfer accepted. Stop responding as ${ctx.agent}. The next continuation should use agent "${recipient.name}".`,
              "</agent_transfer>",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
