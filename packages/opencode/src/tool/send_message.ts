import { Agent } from "@/agent/agent"
import { allowedRecipients, isAllowed } from "@/agent/communication"
import { isSpawnableAgent, spawnableAgentError } from "@/agent/spawnable"
import { Config } from "@/config/config"
import { MessageV2 } from "@/session/message-v2"
import { TaskExecution, type TaskPromptOps } from "@/session/task-execution"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  recipient_agent: Schema.String.annotate({ description: "The specialist agent to message." }),
  message: Schema.String.annotate({ description: "The bounded task or question for the recipient agent." }),
  description: Schema.optional(Schema.String).annotate({
    description: "Short 3-5 word description of the delegated work.",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "Optional prior child session id to resume this agent-to-agent conversation.",
  }),
})

type Metadata = {
  recipientAgent: string
  sessionId: string
  mode: "send_message"
}

export const SendMessageTool = Tool.define<typeof Parameters, Metadata, Agent.Service | Config.Service | TaskExecution.Service>(
  "send_message",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const execution = yield* TaskExecution.Service

    return {
      description:
        "Send a bounded message to another specialist agent and wait for its result. Use this for OpenSwarm-style parallel or multi-specialist delegation where control should return to the sender.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const recipients = allowedRecipients(cfg, ctx.agent, "send_message")
          if (!isAllowed(cfg, ctx.agent, params.recipient_agent, "send_message")) {
            const list = recipients.length ? recipients.join(", ") : "none"
            return yield* Effect.fail(
              new Error(`Agent "${ctx.agent}" cannot send_message to "${params.recipient_agent}". Allowed recipients: ${list}.`),
            )
          }

          const recipient = yield* agents.get(params.recipient_agent)
          if (!recipient) return yield* Effect.fail(new Error(`Unknown recipient agent: ${params.recipient_agent}`))
          if (!isSpawnableAgent(recipient)) return yield* Effect.fail(spawnableAgentError(recipient.name))

          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) return yield* Effect.fail(new Error("send_message requires promptOps in ctx.extra"))

          const current = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
          if (current.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

          const prepared = yield* execution.prepare({
            task: {
              description: params.description ?? `message ${recipient.name}`,
              prompt: params.message,
              subagent_type: recipient.name,
              task_id: params.task_id,
            },
            parentSessionID: ctx.sessionID,
            parentMessageID: ctx.messageID,
            executionMode: "blocking",
            promptOps: ops,
            ask: ctx.ask,
            bypassAgentCheck: true,
          })

          yield* ctx.metadata({
            title: params.description ?? `message ${recipient.name}`,
            metadata: {
              recipientAgent: recipient.name,
              sessionId: prepared.session.id,
              mode: "send_message" as const,
            },
          })

          const result = yield* prepared.run
          return {
            title: result.title,
            metadata: {
              recipientAgent: recipient.name,
              sessionId: prepared.session.id,
              mode: "send_message" as const,
            },
            output: [
              `<agent_message from="${ctx.agent}" to="${recipient.name}" mode="send_message">`,
              result.output,
              "</agent_message>",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
