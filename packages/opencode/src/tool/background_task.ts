import * as Tool from "./tool"
import DESCRIPTION from "./background_task.txt"
import { SessionBackgroundTask } from "../session/background-task"
import { TaskExecution, type TaskInput, type TaskMetadata, type TaskPromptOps } from "../session/task-execution"
import { Effect, Schema } from "effect"

const id = "background_task"

const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
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

export const BackgroundTaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const background = yield* SessionBackgroundTask.Service
    const execution = yield* TaskExecution.Service

    const run = Effect.fn("BackgroundTaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<TaskMetadata>,
    ) {
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) return yield* Effect.fail(new Error("BackgroundTaskTool requires promptOps in ctx.extra"))

      const input = params as TaskInput
      const prepared = yield* execution.prepare({
        task: input,
        executionMode: "background",
        parentSessionID: ctx.sessionID,
        parentMessageID: ctx.messageID,
        promptOps: ops,
        ask: ctx.ask,
        bypassAgentCheck: ctx.extra?.bypassAgentCheck === true,
      })

      yield* ctx.metadata({
        title: input.description,
        metadata: prepared.metadata,
      })

      const task = yield* background.submit({
        parentSessionID: ctx.sessionID,
        description: input.description,
        agent: prepared.subagent.name,
        deliver: (tasks) =>
          ops
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
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<TaskMetadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
