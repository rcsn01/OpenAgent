import * as Tool from "./tool"
import BACKGROUND_DESCRIPTION from "./background_task.txt"
import DESCRIPTION from "./task.txt"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { SessionBackgroundTask } from "../session/background-task"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { ModelID, ProviderID } from "../provider/schema"
import { Cause, Effect, Schema, Scope } from "effect"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const taskPermission = "task"
const taskToolID = "task"
const backgroundTaskToolID = "background_task"

const ExecutionModeSchema = Schema.Union([Schema.Literal("blocking"), Schema.Literal("background")]).annotate({
  identifier: "TaskExecutionMode",
})
type ExecutionMode = Schema.Schema.Type<typeof ExecutionModeSchema>

type TaskMetadata = {
  sessionId: SessionID
  model: {
    modelID: ModelID
    providerID: ProviderID
  }
  executionMode: ExecutionMode
  status?: "running"
}

function renderBackgroundTaskPrompt(tasks: SessionBackgroundTask.Delivery[]) {
  return [
    "<system-reminder>",
    tasks.length === 1
      ? "A background subagent you launched has finished. Use the result below to continue helping the user."
      : "Multiple background subagents you launched have finished. Use the results below to continue helping the user.",
    "",
    ...tasks.flatMap((task) => [
      `<background_task id=\"${task.taskID}\" agent=\"${task.agent}\" status=\"${task.status}\">`,
      `description: ${task.description}`,
      ...(task.title ? [`title: ${task.title}`] : []),
      ...(task.status === "failed"
        ? ["<task_error>", task.error ?? "Task failed", "</task_error>"]
        : ["<task_result>", task.output ?? "", "</task_result>"]),
      "</background_task>",
      "",
    ]),
    "Summarize the completed background work for the user and continue with your task.",
    "</system-reminder>",
  ].join("\n")
}

const SharedParameters = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

export const Parameters = Schema.Struct({
  ...SharedParameters,
  execution_mode: Schema.optional(ExecutionModeSchema).annotate({
    description:
      "Compatibility override for how to run the subagent. Prefer the dedicated background_task tool when you want background execution.",
  }),
})

const BackgroundParameters = Schema.Struct(SharedParameters)
type SharedTaskParams = Schema.Schema.Type<typeof BackgroundParameters>

function defineTaskTool<ParametersSchema extends Schema.Decoder<unknown>, ID extends string>(
  toolID: ID,
  description: string,
  parameters: ParametersSchema,
  executionModeFor: (params: Schema.Schema.Type<ParametersSchema>) => ExecutionMode,
) {
  return Tool.define(
    toolID,
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const background = yield* SessionBackgroundTask.Service
      const config = yield* Config.Service
      const sessions = yield* Session.Service
      const scope = yield* Scope.Scope

      const run = Effect.fn(`${toolID}.execute`)(function* (
        params: Schema.Schema.Type<ParametersSchema>,
        ctx: Tool.Context<TaskMetadata>,
      ) {
        const input = params as SharedTaskParams
        const cfg = yield* config.get()

        if (!ctx.extra?.bypassAgentCheck) {
          yield* ctx.ask({
            permission: taskPermission,
            patterns: [input.subagent_type],
            always: ["*"],
            metadata: {
              description: input.description,
              subagent_type: input.subagent_type,
            },
          })
        }

        const next = yield* agent.get(input.subagent_type)
        if (!next) {
          return yield* Effect.fail(new Error(`Unknown agent type: ${input.subagent_type} is not a valid agent type`))
        }

        const canTask = next.permission.some((rule) => rule.permission === taskPermission)
        const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

        const taskID = input.task_id
        const session = taskID
          ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          : undefined
        const nextSession =
          session ??
          (yield* sessions.create({
            parentID: ctx.sessionID,
            title: input.description + ` (@${next.name} subagent)`,
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

        const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
        if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
        const assistant = msg.info

        const executionMode = executionModeFor(params)

        const model = next.model ?? {
          modelID: assistant.modelID,
          providerID: assistant.providerID,
        }

        const taskMetadata: TaskMetadata = {
          sessionId: nextSession.id,
          model,
          executionMode,
          status: executionMode === "background" ? "running" : undefined,
        }

        yield* ctx.metadata({
          title: input.description,
          metadata: taskMetadata,
        })

        const ops = ctx.extra?.promptOps as TaskPromptOps
        if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

        const runSubagent = Effect.fn(`${toolID}.runSubagent`)(function* () {
          const result = yield* ops.prompt({
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
            parts: yield* ops.resolvePromptParts(input.prompt),
          })

          return {
            title: input.description,
            metadata: taskMetadata,
            output: [
              `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
              "",
              "<task_result>",
              result.parts.findLast((item) => item.type === "text")?.text ?? "",
              "</task_result>",
            ].join("\n"),
          }
        })

        if (executionMode === "background") {
          yield* background.register({
            taskID: nextSession.id,
            parentSessionID: ctx.sessionID,
            description: input.description,
            agent: next.name,
            deliver: (tasks) =>
              ops
                .prompt({
                  sessionID: ctx.sessionID,
                  agent: assistant.agent,
                  model: {
                    modelID: assistant.modelID,
                    providerID: assistant.providerID,
                  },
                  variant: assistant.variant,
                  parts: [{ type: "text", text: renderBackgroundTaskPrompt(tasks), synthetic: true }],
                })
                .pipe(Effect.asVoid),
          })

          yield* runSubagent().pipe(
            Effect.flatMap((result) =>
              background.complete({
                taskID: nextSession.id,
                title: result.title,
                output: result.output,
              }),
            ),
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause)
              return background.fail({
                taskID: nextSession.id,
                error: error instanceof Error ? error.message : String(error),
              })
            }),
            Effect.forkIn(scope),
          )

          return {
            title: input.description,
            metadata: taskMetadata,
            output: [
              `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
              "mode: background",
              "status: running",
              "",
              "<task_status>",
              "The subagent was started in the background. Continue your work while it runs.",
              "</task_status>",
            ].join("\n"),
          }
        }

        function cancel() {
          ops.cancel(nextSession.id)
        }

        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            ctx.abort.addEventListener("abort", cancel)
          }),
          () => runSubagent(),
          () =>
            Effect.sync(() => {
              ctx.abort.removeEventListener("abort", cancel)
            }),
        )
      })

      return {
        description,
        parameters,
        execute: (params: Schema.Schema.Type<ParametersSchema>, ctx: Tool.Context<TaskMetadata>) =>
          run(params, ctx).pipe(Effect.orDie),
      }
    }),
  )
}

export const TaskTool = defineTaskTool(taskToolID, DESCRIPTION, Parameters, (params) => params.execution_mode ?? "blocking")

export const BackgroundTaskTool = defineTaskTool(backgroundTaskToolID, BACKGROUND_DESCRIPTION, BackgroundParameters, () => "background")
