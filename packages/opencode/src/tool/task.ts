import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { SessionBackgroundTask } from "../session/background-task"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { Cause, Effect, Schema, Scope } from "effect"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

const ExecutionMode = Schema.Union([Schema.Literal("blocking"), Schema.Literal("background")]).annotate({
  identifier: "TaskExecutionMode",
})

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

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  execution_mode: Schema.optional(ExecutionMode).annotate({
    description: "How to run the subagent. Use 'blocking' to wait for the result or 'background' to let it continue while you keep working.",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* SessionBackgroundTask.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
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
                    permission: id,
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

      const executionMode = params.execution_mode ?? "blocking"

      const model = next.model ?? {
        modelID: assistant.modelID,
        providerID: assistant.providerID,
      }

      const taskMetadata = {
        sessionId: nextSession.id,
        model,
        executionMode,
        status: executionMode === "background" ? "running" : undefined,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: taskMetadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runSubagent = Effect.fn("TaskTool.runSubagent")(function* () {
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
            ...(canTask ? {} : { task: false }),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts: yield* ops.resolvePromptParts(params.prompt),
        })

        return {
          title: params.description,
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
          description: params.description,
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
          title: params.description,
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
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
