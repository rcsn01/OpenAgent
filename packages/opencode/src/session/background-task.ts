import { SessionTaskGraph } from "./task-graph"
import { SessionID } from "./schema"
import { Context, Effect, Layer } from "effect"

export type Delivery = {
  taskID: SessionID
  parentSessionID: SessionID
  description: string
  agent: string
  status: "completed" | "failed"
  title?: string
  output?: string
  error?: string
  completedAt: number
}

type Status = "running" | Delivery["status"] | "cancelled"

export type Info = {
  taskID: SessionID
  parentSessionID: SessionID
  description: string
  agent: string
  status: Status
  title?: string
  output?: string
  error?: string
  createdAt: number
  completedAt?: number
}

type SubmitInput = {
  parentSessionID: SessionID
  description: string
  agent: string
  deliver: (tasks: Delivery[]) => Effect.Effect<void>
  prepare: () => Effect.Effect<SessionTaskGraph.PreparedNode>
}

export interface Interface {
  readonly submit: (input: SubmitInput) => Effect.Effect<Info>
  readonly list: (sessionID?: SessionID) => Effect.Effect<Info[]>
  readonly get: (taskID: SessionID) => Effect.Effect<Info | undefined>
  readonly cancel: (taskID: SessionID) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionBackgroundTask") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* SessionTaskGraph.Service

    function mapStatus(node: SessionTaskGraph.NodeInfo): Status {
      if (node.status === "completed") return "completed"
      if (node.status === "failed" || node.status === "blocked") return "failed"
      if (node.status === "cancelled") return "cancelled"
      return "running"
    }

    function toInfo(item: SessionTaskGraph.Info): Info | undefined {
      const node = item.nodes[0]
      if (!node?.sessionID) return
      return {
        taskID: node.sessionID,
        parentSessionID: item.parentSessionID,
        description: node.description,
        agent: node.agent,
        status: mapStatus(node),
        title: node.title,
        output: node.output,
        error: node.error,
        createdAt: item.createdAt,
        completedAt: node.completedAt,
      }
    }

    const submit: Interface["submit"] = Effect.fn("SessionBackgroundTask.submit")(function* (input) {
      const created = yield* graph.submit({
        parentSessionID: input.parentSessionID,
        origin: "background_task",
        deliver: (deliveries) =>
          input.deliver(
            deliveries.flatMap((delivery) =>
              delivery.nodes.flatMap((node) => {
                if (!node.sessionID || node.status === "blocked") return []
                return [
                  {
                    taskID: node.sessionID,
                    parentSessionID: delivery.parentSessionID,
                    description: node.description,
                    agent: node.agent,
                    status: node.status,
                    title: node.title,
                    output: node.output,
                    error: node.error,
                    completedAt: node.completedAt,
                  } satisfies Delivery,
                ]
              }),
            ),
          ),
        nodes: [
          {
            nodeID: "task",
            description: input.description,
            agent: input.agent,
            prepare: input.prepare,
          },
        ],
      })

      const info = toInfo(created)
      if (!info) return yield* Effect.fail(new Error("Background task did not start a child session"))
      return info
    })

    const list: Interface["list"] = Effect.fn("SessionBackgroundTask.list")(function* (sessionID) {
      return (yield* graph.list(sessionID))
        .filter((item) => item.origin === "background_task")
        .flatMap((item) => {
          const info = toInfo(item)
          return info ? [info] : []
        })
    })

    const get: Interface["get"] = Effect.fn("SessionBackgroundTask.get")(function* (taskID) {
      const item = yield* graph.findBySession(taskID)
      if (!item || item.origin !== "background_task") return
      return toInfo(item)
    })

    const cancel: Interface["cancel"] = Effect.fn("SessionBackgroundTask.cancel")(function* (taskID) {
      const item = yield* graph.findBySession(taskID)
      if (!item || item.origin !== "background_task") return
      const cancelled = yield* graph.cancel(item.graphID)
      return cancelled ? toInfo(cancelled) : undefined
    })

    return Service.of({ submit, list, get, cancel })
  }),
).pipe(Layer.provide(SessionTaskGraph.layer))

export const defaultLayer = layer

export * as SessionBackgroundTask from "./background-task"