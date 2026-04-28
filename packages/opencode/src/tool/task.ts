import * as Tool from "./tool"
import BACKGROUND_DESCRIPTION from "./background_task.txt"
import DESCRIPTION from "./task.txt"
import { SessionBackgroundTask } from "../session/background-task"
import { TaskExecution, type ExecutionMode, type TaskInput, type TaskMetadata, type TaskPromptOps } from "../session/task-execution"
import { Effect, Schema } from "effect"

export type { TaskMetadata, TaskPromptOps } from "../session/task-execution"

const taskToolID = "task"
const backgroundTaskToolID = "background_task"

const ExecutionModeSchema = Schema.Union([Schema.Literal("blocking"), Schema.Literal("background")]).annotate({
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

function defineTaskTool<ParametersSchema extends Schema.Decoder<unknown>, ID extends string>(
  toolID: ID,
  description: string,
  parameters: ParametersSchema,
  executionModeFor: (params: Schema.Schema.Type<ParametersSchema>) => ExecutionMode,
) {
  return Tool.define(
    toolID,
    Effect.gen(function* () {
      const background = yield* SessionBackgroundTask.Service
      const execution = yield* TaskExecution.Service

      const run = Effect.fn(`${toolID}.execute`)(function* (
        params: Schema.Schema.Type<ParametersSchema>,
        ctx: Tool.Context<TaskMetadata>,
      ) {
        const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
        if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
        const promptOps = ops

        const input = params as TaskInput
        const prepared = yield* execution.prepare({
          task: input,
          executionMode: executionModeFor(params),
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
          promptOps,
          ask: ctx.ask,
          bypassAgentCheck: ctx.extra?.bypassAgentCheck === true,
        })

        yield* ctx.metadata({
          title: input.description,
          metadata: prepared.metadata,
        })

        if (prepared.metadata.executionMode === "background") {
          const task = yield* background.submit({
            parentSessionID: ctx.sessionID,
            description: input.description,
            agent: prepared.subagent.name,
            deliver: (tasks) =>
              promptOps
                .prompt({
                  sessionID: ctx.sessionID,
                  agent: prepared.assistant.agent,
                  model: {
                    modelID: prepared.assistant.modelID,
                    providerID: prepared.assistant.providerID,
                  },
                  variant: prepared.assistant.variant,
                  parts: [{ type: "text", text: renderBackgroundTaskPrompt(tasks), synthetic: true }],
                })
                .pipe(Effect.asVoid),
            prepare: () =>
              Effect.succeed({
                sessionID: prepared.session.id,
                run: prepared.run.pipe(
                  Effect.map((result) => ({
                    title: result.title,
                    output: result.output,
                  })),
                ),
              }),
          })

          return {
            title: input.description,
            metadata: prepared.metadata,
            output: [
              `task_id: ${task.taskID} (for resuming to continue this task if needed)`,
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
          promptOps.cancel(prepared.session.id)
        }

        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            ctx.abort.addEventListener("abort", cancel)
          }),
          () => prepared.run,
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
