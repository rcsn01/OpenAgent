import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

const TodoStatusAliases = {
  "not-started": "pending",
  "not_started": "pending",
  "in-progress": "in_progress",
  inprogress: "in_progress",
  canceled: "cancelled",
} as const

// Todo.Info is still a zod schema (session/todo.ts). Inline the field shape
// here rather than referencing its `.shape` — the LLM-visible JSON Schema is
// identical, and it removes the last zod dependency from this tool.
const TodoItem = Schema.Struct({
  content: Schema.optional(Schema.String).annotate({ description: "Brief description of the task" }),
  title: Schema.optional(Schema.String).annotate({
    description: "Alternate task title field accepted for compatibility",
  }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.optional(Schema.String).annotate({ description: "Priority level of the task: high, medium, low" }),
})

const TodoList = Schema.mutable(Schema.Array(TodoItem)).annotate({ description: "The updated todo list" })

export const Parameters = Schema.Union([
  Schema.Struct({
    todos: TodoList,
  }),
  Schema.Struct({
    todoList: TodoList,
  }),
])

type Metadata = {
  todos: Todo.Info[]
}

function normalizeStatus(status: string): string {
  const key = status.trim().toLowerCase().replace(/\s+/g, "_")
  return TodoStatusAliases[key as keyof typeof TodoStatusAliases] ?? status
}

function normalizeTodos(params: Schema.Schema.Type<typeof Parameters>) {
  const items = "todos" in params ? params.todos : params.todoList

  return items.map((item, index) => ({
    content: item.content?.trim() || item.title?.trim() || `Task ${index + 1}`,
    status: normalizeStatus(item.status),
    priority: item.priority?.trim() || "medium",
  }))
}

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const todos = normalizeTodos(params)

          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          yield* todo.update({
            sessionID: ctx.sessionID,
            todos,
          })

          return {
            title: `${todos.filter((x) => x.status !== "completed").length} todos`,
            output: JSON.stringify(todos, null, 2),
            metadata: {
              todos,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
