import { Effect, Schema } from "effect"
import { SessionBackgroundTask } from "../session/background-task"
import { SessionID } from "../session/schema"
import * as Tool from "./tool"

type TaskSummary = {
  taskId: SessionID
  parentSessionId: SessionID
  agent: string
  description: string
  status: SessionBackgroundTask.Info["status"]
  createdAt: number
  completedAt: number | undefined
}

type ListMetadata = {
  count: number
  tasks: TaskSummary[]
}

type GetMetadata = {
  found: boolean
  taskId: string
  task?: TaskSummary
}

type CancelMetadata = {
  found: boolean
  taskId: string
  cancelled: boolean
  task?: TaskSummary
}

const LIST_DESCRIPTION =
  "List background subagent tasks for the current session. Use this after context compaction or when you need to see which delegated tasks are still running or waiting to be delivered."

const GET_DESCRIPTION =
  "Get the current status and details for one background subagent task by task_id. Use this when you need to inspect a specific delegated task."

const CANCEL_DESCRIPTION =
  "Cancel a background subagent task by task_id. Use this when the delegated work is no longer needed or should not be delivered back into the conversation."

function renderTask(task: SessionBackgroundTask.Info) {
  return [
    `<background_task id="${task.taskID}" agent="${task.agent}" status="${task.status}">`,
    `description: ${task.description}`,
    `created_at: ${task.createdAt}`,
    ...(task.completedAt ? [`completed_at: ${task.completedAt}`] : []),
    ...(task.title ? [`title: ${task.title}`] : []),
    ...(task.error ? [`error: ${task.error}`] : []),
    ...(task.output ? ["<task_result>", task.output, "</task_result>"] : []),
    `</background_task>`,
  ].join("\n")
}

function summarize(task: SessionBackgroundTask.Info): TaskSummary {
  return {
    taskId: task.taskID,
    parentSessionId: task.parentSessionID,
    agent: task.agent,
    description: task.description,
    status: task.status,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  }
}

const EmptyParameters = Schema.Struct({})

const GetParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The task_id returned when the background subagent was launched." }),
})

const CancelParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The task_id of the background task to cancel." }),
})

export const BackgroundTaskListTool = Tool.define<typeof EmptyParameters, ListMetadata, SessionBackgroundTask.Service>(
  "background_task_list",
  Effect.gen(function* () {
    const background = yield* SessionBackgroundTask.Service

    return {
      description: LIST_DESCRIPTION,
      parameters: EmptyParameters,
      execute: (_params: Schema.Schema.Type<typeof EmptyParameters>, ctx: Tool.Context<ListMetadata>) =>
        Effect.gen(function* () {
          const tasks = yield* background.list(ctx.sessionID)
          return {
            title: `${tasks.length} background task${tasks.length === 1 ? "" : "s"}`,
            output:
              tasks.length === 0
                ? "No background tasks are currently tracked for this session."
                : tasks.map((task) => renderTask(task)).join("\n\n"),
            metadata: {
              count: tasks.length,
              tasks: tasks.map((task) => summarize(task)),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const BackgroundTaskGetTool = Tool.define<typeof GetParameters, GetMetadata, SessionBackgroundTask.Service>(
  "background_task_get",
  Effect.gen(function* () {
    const background = yield* SessionBackgroundTask.Service

    return {
      description: GET_DESCRIPTION,
      parameters: GetParameters,
      execute: (params: Schema.Schema.Type<typeof GetParameters>, ctx: Tool.Context<GetMetadata>) =>
        Effect.gen(function* () {
          const task = yield* background.get(SessionID.make(params.task_id))
          if (!task || task.parentSessionID !== ctx.sessionID) {
            return {
              title: "Background task not found",
              output:
                "No tracked background task with that task_id was found for this session. It may have already been delivered, cancelled, or never existed.",
              metadata: {
                found: false,
                taskId: params.task_id,
                task: undefined,
              },
            }
          }

          return {
            title: `${task.agent} background task`,
            output: renderTask(task),
            metadata: {
              found: true,
              taskId: params.task_id,
              task: summarize(task),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const BackgroundTaskCancelTool = Tool.define<
  typeof CancelParameters,
  CancelMetadata,
  SessionBackgroundTask.Service
>(
  "background_task_cancel",
  Effect.gen(function* () {
    const background = yield* SessionBackgroundTask.Service

    return {
      description: CANCEL_DESCRIPTION,
      parameters: CancelParameters,
      execute: (params: Schema.Schema.Type<typeof CancelParameters>, ctx: Tool.Context<CancelMetadata>) =>
        Effect.gen(function* () {
          const task = yield* background.get(SessionID.make(params.task_id))
          if (!task || task.parentSessionID !== ctx.sessionID) {
            return {
              title: "Background task not found",
              output:
                "No tracked background task with that task_id was found for this session. It may have already been delivered, cancelled, or never existed.",
              metadata: {
                found: false,
                taskId: params.task_id,
                cancelled: false,
                task: undefined,
              },
            }
          }

          yield* ctx.ask({
            permission: "task",
            patterns: [task.agent],
            always: [task.agent],
            metadata: {
              task_id: params.task_id,
              description: task.description,
              subagent_type: task.agent,
            },
          })

          const cancelled = yield* background.cancel(task.taskID)
          if (!cancelled) {
            return {
              title: "Background task not found",
              output:
                "The background task disappeared before it could be cancelled. It may have completed or been removed already.",
              metadata: {
                found: false,
                taskId: params.task_id,
                cancelled: false,
                task: undefined,
              },
            }
          }

          return {
            title: `Cancelled ${cancelled.agent} background task`,
            output: [
              `task_id: ${cancelled.taskID}`,
              `agent: ${cancelled.agent}`,
              `status: cancelled`,
              `description: ${cancelled.description}`,
            ].join("\n"),
            metadata: {
              found: true,
              taskId: params.task_id,
              cancelled: true,
              task: summarize(cancelled),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)