import { Agent } from "@/agent/agent"
import { allowedRecipients, isAllowed } from "@/agent/communication"
import { isSpawnableAgent, spawnableAgentError } from "@/agent/spawnable"
import { Config } from "@/config/config"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { TaskExecution, type TaskPromptOps } from "@/session/task-execution"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  recipient_agent: Schema.String.annotate({ description: "The subagent or specialist agent to message." }),
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

const agentTitleSuffix = (agent: string) => `(@${agent} subagent)`

export const SendMessageTool = Tool.define<
  typeof Parameters,
  Metadata,
  Agent.Service | Config.Service | Session.Service | TaskExecution.Service
>(
  "send_message",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const execution = yield* TaskExecution.Service

    return {
      description:
        "Send a bounded message to another subagent or specialist agent and wait for its result. Use this for OpenSwarm-style parallel or multi-agent delegation where control should return to the sender.",
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

          const existingSession = params.task_id
            ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
            : yield* sessions
                .children(ctx.sessionID)
                .pipe(
                  Effect.map((children) =>
                    children
                      .filter((child) => child.title.includes(agentTitleSuffix(recipient.name)))
                      .toSorted((a, b) => b.time.updated - a.time.updated)[0],
                  ),
                )

          if (!existingSession) {
            return yield* Effect.fail(
              new Error(
                [
                  `No existing ${recipient.name} subagent session is available for send_message.`,
                  `Create or choose a ${recipient.name} subagent session first, then call send_message with that session's task_id.`,
                ].join(" "),
              ),
            )
          }

          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) return yield* Effect.fail(new Error("send_message requires promptOps in ctx.extra"))

          const current = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
          if (current.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

          const prepared = yield* execution.prepare({
            task: {
              description: params.description ?? `message ${recipient.name}`,
              prompt: params.message,
              subagent_type: recipient.name,
              task_id: existingSession.id,
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
