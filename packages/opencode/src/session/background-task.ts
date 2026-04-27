import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { Log } from "@/util"
import { SessionRunState } from "./run-state"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { Cause, Effect, Layer, Scope, Context } from "effect"
import * as Stream from "effect/Stream"

const log = Log.create({ service: "session.background-task" })

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

type Status = "running" | Delivery["status"]

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

type RegisterInput = {
  taskID: SessionID
  parentSessionID: SessionID
  description: string
  agent: string
  deliver: (tasks: Delivery[]) => Effect.Effect<void>
}

type CompleteInput = {
  taskID: SessionID
  title: string
  output: string
}

type FailInput = {
  taskID: SessionID
  error: string
}

type State = {
  tasks: Map<SessionID, Info>
  delivery: Map<SessionID, RegisterInput["deliver"]>
  flushing: Set<SessionID>
}

export interface Interface {
  readonly register: (input: RegisterInput) => Effect.Effect<void>
  readonly complete: (input: CompleteInput) => Effect.Effect<void>
  readonly fail: (input: FailInput) => Effect.Effect<void>
  readonly list: (sessionID?: SessionID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionBackgroundTask") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const runState = yield* SessionRunState.Service
    let flush: (parentSessionID: SessionID) => Effect.Effect<void> = () => Effect.void

    const state = yield* InstanceState.make<State>(
      Effect.fn("SessionBackgroundTask.state")((): Effect.Effect<State, never, Scope.Scope> =>
        Effect.gen(function* () {
          const value: State = {
            tasks: new Map(),
            delivery: new Map(),
            flushing: new Set(),
          }

          yield* bus.subscribe(SessionStatus.Event.Idle).pipe(
            Stream.runForEach((event) => flush(event.properties.sessionID)),
            Effect.forkScoped,
          )

          return value
        }),
      ),
    )

    const cleanupParent = Effect.fnUntraced(function* (parentSessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const hasPending = [...data.tasks.values()].some((item) => item.parentSessionID === parentSessionID)
      if (!hasPending) data.delivery.delete(parentSessionID)
    })

    flush = Effect.fn("SessionBackgroundTask.flush")(function* (parentSessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      if (data.flushing.has(parentSessionID)) return
      data.flushing.add(parentSessionID)

      yield* Effect.gen(function* () {
        while (true) {
          if ((yield* status.get(parentSessionID)).type !== "idle") return

          const available = yield* runState
            .assertNotBusy(parentSessionID)
            .pipe(Effect.as(true), Effect.catchCause(() => Effect.succeed(false)))
          if (!available) return

          const deliver = data.delivery.get(parentSessionID)
          if (!deliver) return

          const ready = [...data.tasks.values()]
            .filter((item) => item.parentSessionID === parentSessionID && item.status !== "running")
            .sort((left, right) => (left.completedAt ?? left.createdAt) - (right.completedAt ?? right.createdAt))

          if (ready.length === 0) {
            yield* cleanupParent(parentSessionID)
            return
          }

          const delivered = yield* deliver(
            ready.map((item) => ({
              taskID: item.taskID,
              parentSessionID: item.parentSessionID,
              description: item.description,
              agent: item.agent,
              status: item.status === "failed" ? "failed" : "completed",
              title: item.title,
              output: item.output,
              error: item.error,
              completedAt: item.completedAt ?? item.createdAt,
            })),
          ).pipe(
            Effect.as(true),
            Effect.catchCause((cause) => {
              log.error("failed to deliver background tasks", {
                parentSessionID,
                error: Cause.squash(cause),
              })
              return Effect.succeed(false)
            }),
          )

          if (!delivered) return

          ready.forEach((item) => data.tasks.delete(item.taskID))
          yield* cleanupParent(parentSessionID)
        }
      }).pipe(Effect.ensuring(Effect.sync(() => data.flushing.delete(parentSessionID))))
    })

    const maybeFlush = Effect.fnUntraced(function* (parentSessionID: SessionID) {
      if ((yield* status.get(parentSessionID)).type !== "idle") return
      yield* flush(parentSessionID)
    })

    const register: Interface["register"] = Effect.fn("SessionBackgroundTask.register")(function* (input) {
      const data = yield* InstanceState.get(state)
      data.tasks.set(input.taskID, {
        taskID: input.taskID,
        parentSessionID: input.parentSessionID,
        description: input.description,
        agent: input.agent,
        status: "running",
        createdAt: Date.now(),
      })
      data.delivery.set(input.parentSessionID, input.deliver)
    })

    const complete: Interface["complete"] = Effect.fn("SessionBackgroundTask.complete")(function* (input) {
      const data = yield* InstanceState.get(state)
      const task = data.tasks.get(input.taskID)
      if (!task) return
      task.status = "completed"
      task.title = input.title
      task.output = input.output
      task.completedAt = Date.now()
      yield* maybeFlush(task.parentSessionID)
    })

    const fail: Interface["fail"] = Effect.fn("SessionBackgroundTask.fail")(function* (input) {
      const data = yield* InstanceState.get(state)
      const task = data.tasks.get(input.taskID)
      if (!task) return
      task.status = "failed"
      task.error = input.error
      task.completedAt = Date.now()
      yield* maybeFlush(task.parentSessionID)
    })

    const list: Interface["list"] = Effect.fn("SessionBackgroundTask.list")(function* (sessionID) {
      const data = yield* InstanceState.get(state)
      return [...data.tasks.values()].filter((item) => !sessionID || item.parentSessionID === sessionID)
    })

    return Service.of({ register, complete, fail, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(SessionRunState.defaultLayer),
)

export * as SessionBackgroundTask from "./background-task"