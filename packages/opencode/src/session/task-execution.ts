import { Agent } from "@/agent/agent"
import { isSpawnableAgent, spawnableAgentError } from "@/agent/spawnable"
import { Config } from "@/config/config"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Permission } from "@/permission"
import { Session } from "@/session/session"
import { MessageV2 } from "./message-v2"
import { MessageID, SessionID } from "./schema"
import type { SessionPrompt } from "./prompt"
import { Context, Effect, Layer } from "effect"

const taskPermission = "task"
const taskToolID = "task"
const backgroundTaskToolID = "background_task"

export type TaskPromptOps = {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

export type TaskInput = {
  description: string
  prompt: string
  subagent_type: string
  task_id?: string
  command?: string
}

export type ExecutionMode = "blocking" | "background"

export type TaskMetadata = {
  sessionId: SessionID
  model: {
    modelID: ModelID
    providerID: ProviderID
  }
  executionMode: ExecutionMode
  status?: "running"
}

export type RunResult = {
  title: string
  metadata: TaskMetadata
  output: string
}

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

export type PrepareInput = {
  task: TaskInput
  parentSessionID: SessionID
  parentMessageID: MessageID
  executionMode: ExecutionMode
  promptOps: TaskPromptOps
  ask: (input: PermissionRequest) => Effect.Effect<void>
  bypassAgentCheck?: boolean
}

export type PreparedTask = {
  session: Session.Info
  assistant: MessageV2.Assistant
  subagent: Agent.Info
  metadata: TaskMetadata
  run: Effect.Effect<RunResult>
}

export interface Interface {
  readonly prepare: (input: PrepareInput) => Effect.Effect<PreparedTask, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskExecution") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const prepare: Interface["prepare"] = Effect.fn("TaskExecution.prepare")(function* (input) {
      const cfg = yield* config.get()

      if (!input.bypassAgentCheck) {
        yield* input.ask({
          permission: taskPermission,
          patterns: [input.task.subagent_type],
          always: ["*"],
          metadata: {
            description: input.task.description,
            subagent_type: input.task.subagent_type,
          },
        })
      }

      const next = yield* agent.get(input.task.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${input.task.subagent_type} is not a valid agent type`))
      }
      if (!isSpawnableAgent(next)) return yield* Effect.fail(spawnableAgentError(next.name))

      const canTask = next.permission.some((rule) => rule.permission === taskPermission)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const resumed = input.task.task_id
        ? yield* sessions.get(SessionID.make(input.task.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        resumed ??
        (yield* sessions.create({
          parentID: input.parentSessionID,
          title: input.task.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: taskPermission,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const message = yield* Effect.sync(() =>
        MessageV2.get({ sessionID: input.parentSessionID, messageID: input.parentMessageID }),
      )
      if (message.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const assistant = message.info
      const model = next.model ?? {
        modelID: assistant.modelID,
        providerID: assistant.providerID,
      }

      const metadata: TaskMetadata = {
        sessionId: nextSession.id,
        model,
        executionMode: input.executionMode,
        status: input.executionMode === "background" ? "running" : undefined,
      }

      const run = Effect.fn("TaskExecution.runSubagent")(function* () {
        const result = yield* input.promptOps.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: next.name,
          tools: {
            ...(canTodo ? {} : { todowrite: false }),
            ...(canTask ? {} : { [taskToolID]: false, [backgroundTaskToolID]: false }),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts: yield* input.promptOps.resolvePromptParts(input.task.prompt),
        })

        return {
          title: input.task.description,
          metadata,
          output: [
            `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
            "",
            "<task_result>",
            result.parts.findLast((item) => item.type === "text")?.text ?? "",
            "</task_result>",
          ].join("\n"),
        } satisfies RunResult
      })

      return {
        session: nextSession,
        assistant,
        subagent: next,
        metadata,
        run: run(),
      } satisfies PreparedTask
    })

    return Service.of({ prepare })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Session.defaultLayer),
  ),
)

export * as TaskExecution from "./task-execution"
