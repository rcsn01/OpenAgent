import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { Log } from "@/util"
import { SessionRunState } from "./run-state"
import { SessionID, TaskGraphID } from "./schema"
import { SessionStatus } from "./status"
import { Cause, Context, Effect, Layer, Scope } from "effect"
import * as Stream from "effect/Stream"

const log = Log.create({ service: "session.task-graph" })

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled"
export type GraphStatus = "active" | "completed" | "failed" | "cancelled"
export type GraphOrigin = "background_task" | "background_task_graph"

export type DeliveryNode = {
  graphID: TaskGraphID
  parentSessionID: SessionID
  nodeID: string
  description: string
  agent: string
  status: "completed" | "failed" | "blocked"
  sessionID?: SessionID
  title?: string
  output?: string
  error?: string
  blockedBy?: string[]
  completedAt: number
}

export type Delivery = {
  graphID: TaskGraphID
  parentSessionID: SessionID
  status: GraphStatus
  nodes: DeliveryNode[]
}

export type NodeInfo = {
  graphID: TaskGraphID
  nodeID: string
  description: string
  agent: string
  dependencies: string[]
  status: NodeStatus
  sessionID?: SessionID
  title?: string
  output?: string
  error?: string
  blockedBy?: string[]
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export type Info = {
  graphID: TaskGraphID
  parentSessionID: SessionID
  origin: GraphOrigin
  status: GraphStatus
  createdAt: number
  completedAt?: number
  nodes: NodeInfo[]
}

export type PreparedNode = {
  sessionID: SessionID
  run: Effect.Effect<{
    title: string
    output: string
  }>
}

type SubmitNode = {
  nodeID: string
  description: string
  agent: string
  dependencies?: string[]
  prepare: () => Effect.Effect<PreparedNode>
}

type SubmitInput = {
  parentSessionID: SessionID
  origin: GraphOrigin
  deliver: (deliveries: Delivery[]) => Effect.Effect<void>
  nodes: SubmitNode[]
}

type NodeRecord = NodeInfo

type GraphRecord = {
  graphID: TaskGraphID
  parentSessionID: SessionID
  origin: GraphOrigin
  status: GraphStatus
  createdAt: number
  completedAt?: number
  nodeOrder: string[]
  nodes: Map<string, NodeRecord>
  reverseDependencies: Map<string, string[]>
  runtime: Map<string, SubmitNode>
  pendingDelivery: Set<string>
  suppressDelivery: boolean
}

type State = {
  graphs: Map<TaskGraphID, GraphRecord>
  delivery: Map<SessionID, SubmitInput["deliver"]>
  flushing: Set<SessionID>
  scheduling: Set<TaskGraphID>
}

export interface Interface {
  readonly submit: (input: SubmitInput) => Effect.Effect<Info>
  readonly list: (sessionID?: SessionID) => Effect.Effect<Info[]>
  readonly get: (graphID: TaskGraphID) => Effect.Effect<Info | undefined>
  readonly cancel: (graphID: TaskGraphID) => Effect.Effect<Info | undefined>
  readonly findBySession: (sessionID: SessionID) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTaskGraph") {}

function cloneNode(node: NodeRecord): NodeInfo {
  return {
    ...node,
    dependencies: [...node.dependencies],
    blockedBy: node.blockedBy ? [...node.blockedBy] : undefined,
  }
}

function cloneGraph(graph: GraphRecord): Info {
  return {
    graphID: graph.graphID,
    parentSessionID: graph.parentSessionID,
    origin: graph.origin,
    status: graph.status,
    createdAt: graph.createdAt,
    completedAt: graph.completedAt,
    nodes: graph.nodeOrder.flatMap((nodeID) => {
      const node = graph.nodes.get(nodeID)
      return node ? [cloneNode(node)] : []
    }),
  }
}

function isTerminal(status: NodeStatus) {
  return ["completed", "failed", "blocked", "cancelled"].includes(status)
}

function deliveryStatus(node: NodeRecord): DeliveryNode["status"] | undefined {
  if (node.status === "completed") return "completed"
  if (node.status === "failed") return "failed"
  if (node.status === "blocked") return "blocked"
  return
}

function validateNodes(nodes: SubmitNode[]) {
  if (nodes.length === 0) throw new Error("Task graph must include at least one node")

  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.nodeID)) throw new Error(`Duplicate task graph node id: ${node.nodeID}`)
    ids.add(node.nodeID)
  }

  for (const node of nodes) {
    const dependencies = node.dependencies ?? []
    for (const dependency of dependencies) {
      if (!ids.has(dependency)) throw new Error(`Unknown task graph dependency: ${dependency}`)
      if (dependency === node.nodeID) throw new Error(`Task graph node cannot depend on itself: ${node.nodeID}`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byID = new Map(nodes.map((node) => [node.nodeID, node]))

  const walk = (nodeID: string) => {
    if (visited.has(nodeID)) return
    if (visiting.has(nodeID)) throw new Error(`Task graph contains a cycle involving node: ${nodeID}`)
    visiting.add(nodeID)
    const node = byID.get(nodeID)
    if (!node) return
    for (const dependency of node.dependencies ?? []) walk(dependency)
    visiting.delete(nodeID)
    visited.add(nodeID)
  }

  for (const node of nodes) walk(node.nodeID)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const runState = yield* SessionRunState.Service
    const scope = yield* Scope.Scope
    let flush: (parentSessionID: SessionID) => Effect.Effect<void> = () => Effect.void
    let cleanupParent: (parentSessionID: SessionID) => Effect.Effect<void> = () => Effect.void
    let maybeFlush: (parentSessionID: SessionID) => Effect.Effect<void> = () => Effect.void
    let schedule: (graphID: TaskGraphID) => Effect.Effect<void> = () => Effect.void
    let cleanupGraph: (graphID: TaskGraphID) => Effect.Effect<void> = () => Effect.void

    const state = yield* InstanceState.make<State>(
      Effect.fn("SessionTaskGraph.state")((): Effect.Effect<State, never, Scope.Scope> =>
        Effect.gen(function* () {
          const value: State = {
            graphs: new Map(),
            delivery: new Map(),
            flushing: new Set(),
            scheduling: new Set(),
          }

          yield* bus.subscribe(SessionStatus.Event.Idle).pipe(
            Stream.runForEach((event) => flush(event.properties.sessionID)),
            Effect.forkScoped,
          )

          return value
        }),
      ),
    )

    const recomputeStatus = (graph: GraphRecord) => {
      if (graph.status === "cancelled") return
      const nodes = [...graph.nodes.values()]
      if (nodes.some((node) => node.status === "pending" || node.status === "running")) {
        graph.status = "active"
        graph.completedAt = undefined
        return
      }
      graph.status = nodes.every((node) => node.status === "completed") ? "completed" : "failed"
      graph.completedAt ??= Date.now()
    }

    const blockDownstream = (graph: GraphRecord, blockerID: string) => {
      const queue = [...(graph.reverseDependencies.get(blockerID) ?? [])]
      while (queue.length > 0) {
        const nodeID = queue.shift()
        if (!nodeID) continue
        const node = graph.nodes.get(nodeID)
        if (!node || node.status !== "pending") continue
        node.status = "blocked"
        node.blockedBy = [...new Set([...(node.blockedBy ?? []), blockerID])]
        node.error = `Blocked by failed dependencies: ${node.blockedBy.join(", ")}`
        node.completedAt = Date.now()
        if (!graph.suppressDelivery) graph.pendingDelivery.add(node.nodeID)
        queue.push(...(graph.reverseDependencies.get(nodeID) ?? []))
      }
    }

    cleanupParent = Effect.fnUntraced(function* (parentSessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const hasPending = [...data.graphs.values()].some((graph) => graph.parentSessionID === parentSessionID)
      if (!hasPending) data.delivery.delete(parentSessionID)
    })

    cleanupGraph = Effect.fnUntraced(function* (graphID: TaskGraphID) {
      const data = yield* InstanceState.get(state)
      const graph = data.graphs.get(graphID)
      if (!graph) return
      if (graph.status === "active") return
      if (!graph.suppressDelivery && graph.pendingDelivery.size > 0) return
      data.graphs.delete(graphID)
      yield* cleanupParent(graph.parentSessionID)
    })

    const completeNode = Effect.fn("SessionTaskGraph.completeNode")(function* (
      graphID: TaskGraphID,
      nodeID: string,
      result: { title: string; output: string },
    ) {
      const data = yield* InstanceState.get(state)
      const graph = data.graphs.get(graphID)
      const node = graph?.nodes.get(nodeID)
      if (!graph || !node || node.status !== "running") return
      node.status = "completed"
      node.title = result.title
      node.output = result.output
      node.completedAt = Date.now()
      if (!graph.suppressDelivery) graph.pendingDelivery.add(node.nodeID)
      recomputeStatus(graph)
      yield* maybeFlush(graph.parentSessionID)
      yield* schedule(graphID)
      yield* cleanupGraph(graphID)
    })

    const failNode = Effect.fn("SessionTaskGraph.failNode")(function* (graphID: TaskGraphID, nodeID: string, error: string) {
      const data = yield* InstanceState.get(state)
      const graph = data.graphs.get(graphID)
      const node = graph?.nodes.get(nodeID)
      if (!graph || !node || isTerminal(node.status)) return
      node.status = "failed"
      node.error = error
      node.completedAt = Date.now()
      if (!graph.suppressDelivery) graph.pendingDelivery.add(node.nodeID)
      blockDownstream(graph, node.nodeID)
      recomputeStatus(graph)
      yield* maybeFlush(graph.parentSessionID)
      yield* schedule(graphID)
      yield* cleanupGraph(graphID)
    })

    const launchNode = Effect.fn("SessionTaskGraph.launchNode")(function* (graphID: TaskGraphID, nodeID: string) {
      const data = yield* InstanceState.get(state)
      const graph = data.graphs.get(graphID)
      const node = graph?.nodes.get(nodeID)
      if (!graph || !node || graph.status !== "active" || node.status !== "pending") return
      const ready = node.dependencies.every((dependency) => graph.nodes.get(dependency)?.status === "completed")
      if (!ready) return
      const runtime = graph.runtime.get(nodeID)
      if (!runtime) return yield* failNode(graphID, nodeID, `Missing runtime for task graph node: ${nodeID}`)

      const prepared = yield* runtime.prepare().pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) => {
            const error = Cause.squash(cause)
            return failNode(graphID, nodeID, error instanceof Error ? error.message : String(error)).pipe(Effect.as(undefined))
          },
          onSuccess: Effect.succeed,
        }),
      )
      if (!prepared) return

      const currentGraph = data.graphs.get(graphID)
      const currentNode = currentGraph?.nodes.get(nodeID)
      if (!currentGraph || !currentNode || currentGraph.status !== "active" || currentNode.status !== "pending") return

      currentNode.status = "running"
      currentNode.sessionID = prepared.sessionID
      currentNode.startedAt = Date.now()

      yield* prepared.run.pipe(
        Effect.flatMap((result) => completeNode(graphID, nodeID, result)),
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause)
          return failNode(graphID, nodeID, error instanceof Error ? error.message : String(error))
        }),
        Effect.forkIn(scope),
      )
    })

    schedule = Effect.fn("SessionTaskGraph.schedule")(function* (graphID: TaskGraphID) {
      const data = yield* InstanceState.get(state)
      const graph = data.graphs.get(graphID)
      if (!graph || graph.status !== "active" || data.scheduling.has(graphID)) return
      data.scheduling.add(graphID)

      yield* Effect.gen(function* () {
        const runnable = graph.nodeOrder.flatMap((nodeID) => {
          const node = graph.nodes.get(nodeID)
          if (!node || node.status !== "pending") return []
          const ready = node.dependencies.every((dependency) => graph.nodes.get(dependency)?.status === "completed")
          return ready ? [nodeID] : []
        })

        if (runnable.length === 0) {
          recomputeStatus(graph)
          yield* cleanupGraph(graphID)
          return
        }

        yield* Effect.forEach(runnable, (nodeID) => launchNode(graphID, nodeID), {
          concurrency: "unbounded",
          discard: true,
        })
      }).pipe(Effect.ensuring(Effect.sync(() => data.scheduling.delete(graphID))))
    })

    flush = Effect.fn("SessionTaskGraph.flush")(function* (parentSessionID: SessionID) {
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

          const ready = [...data.graphs.values()]
            .filter((graph) => graph.parentSessionID === parentSessionID && !graph.suppressDelivery && graph.pendingDelivery.size > 0)
            .map((graph) => {
              const nodeIDs = graph.nodeOrder.filter((nodeID) => graph.pendingDelivery.has(nodeID))
              const nodes = nodeIDs.flatMap((nodeID) => {
                const node = graph.nodes.get(nodeID)
                const status = node ? deliveryStatus(node) : undefined
                if (!node || !status) return []
                return [
                  {
                    graphID: graph.graphID,
                    parentSessionID: graph.parentSessionID,
                    nodeID: node.nodeID,
                    description: node.description,
                    agent: node.agent,
                    status,
                    sessionID: node.sessionID,
                    title: node.title,
                    output: node.output,
                    error: node.error,
                    blockedBy: node.blockedBy ? [...node.blockedBy] : undefined,
                    completedAt: node.completedAt ?? node.createdAt,
                  } satisfies DeliveryNode,
                ]
              })
              return {
                graph,
                nodeIDs,
                delivery: {
                  graphID: graph.graphID,
                  parentSessionID: graph.parentSessionID,
                  status: graph.status,
                  nodes,
                } satisfies Delivery,
              }
            })
            .filter((item) => item.delivery.nodes.length > 0)
            .sort((left, right) => {
              const a = left.delivery.nodes[0]?.completedAt ?? left.graph.createdAt
              const b = right.delivery.nodes[0]?.completedAt ?? right.graph.createdAt
              return a - b
            })

          if (ready.length === 0) {
            yield* cleanupParent(parentSessionID)
            return
          }

          const delivered = yield* deliver(ready.map((item) => item.delivery)).pipe(
            Effect.as(true),
            Effect.catchCause((cause) => {
              log.error("failed to deliver task graph updates", {
                parentSessionID,
                error: Cause.squash(cause),
              })
              return Effect.succeed(false)
            }),
          )

          if (!delivered) return

          for (const item of ready) {
            for (const nodeID of item.nodeIDs) item.graph.pendingDelivery.delete(nodeID)
            yield* cleanupGraph(item.graph.graphID)
          }
        }
      }).pipe(Effect.ensuring(Effect.sync(() => data.flushing.delete(parentSessionID))))
    })

    maybeFlush = Effect.fnUntraced(function* (parentSessionID: SessionID) {
      if ((yield* status.get(parentSessionID)).type !== "idle") return
      yield* flush(parentSessionID)
    })

    const submit: Interface["submit"] = Effect.fn("SessionTaskGraph.submit")(function* (input) {
      validateNodes(input.nodes)
      const data = yield* InstanceState.get(state)
      const graphID = TaskGraphID.ascending()
      const createdAt = Date.now()
      const nodeOrder = input.nodes.map((node) => node.nodeID)
      const reverseDependencies = new Map<string, string[]>()
      const nodes = new Map<string, NodeRecord>()
      const runtime = new Map<string, SubmitNode>()

      for (const node of input.nodes) {
        nodes.set(node.nodeID, {
          graphID,
          nodeID: node.nodeID,
          description: node.description,
          agent: node.agent,
          dependencies: [...(node.dependencies ?? [])],
          status: "pending",
          createdAt,
        })
        runtime.set(node.nodeID, node)
        reverseDependencies.set(node.nodeID, [])
      }

      for (const node of input.nodes) {
        for (const dependency of node.dependencies ?? []) {
          reverseDependencies.set(dependency, [...(reverseDependencies.get(dependency) ?? []), node.nodeID])
        }
      }

      const graph: GraphRecord = {
        graphID,
        parentSessionID: input.parentSessionID,
        origin: input.origin,
        status: "active",
        createdAt,
        nodeOrder,
        nodes,
        reverseDependencies,
        runtime,
        pendingDelivery: new Set(),
        suppressDelivery: false,
      }

      data.graphs.set(graphID, graph)
      data.delivery.set(input.parentSessionID, input.deliver)

      yield* schedule(graphID)

      return cloneGraph(graph)
    })

    const list: Interface["list"] = Effect.fn("SessionTaskGraph.list")(function* (sessionID) {
      const data = yield* InstanceState.get(state)
      return [...data.graphs.values()]
        .filter((graph) => !sessionID || graph.parentSessionID === sessionID)
        .sort((left, right) => left.createdAt - right.createdAt)
        .map(cloneGraph)
    })

    const get: Interface["get"] = Effect.fn("SessionTaskGraph.get")(function* (graphID) {
      const data = yield* InstanceState.get(state)
      const graph = data.graphs.get(graphID)
      if (!graph) return
      return cloneGraph(graph)
    })

    const findBySession: Interface["findBySession"] = Effect.fn("SessionTaskGraph.findBySession")(function* (sessionID) {
      const data = yield* InstanceState.get(state)
      const graph = [...data.graphs.values()].find((item) =>
        item.nodeOrder.some((nodeID) => item.nodes.get(nodeID)?.sessionID === sessionID),
      )
      if (!graph) return
      return cloneGraph(graph)
    })

    const cancel: Interface["cancel"] = Effect.fn("SessionTaskGraph.cancel")(function* (graphID) {
      const data = yield* InstanceState.get(state)
      const graph = data.graphs.get(graphID)
      if (!graph) return

      const running = graph.nodeOrder.flatMap((nodeID) => {
        const node = graph.nodes.get(nodeID)
        return node?.status === "running" && node.sessionID ? [node.sessionID] : []
      })

      const now = Date.now()
      graph.suppressDelivery = true
      graph.pendingDelivery.clear()
      graph.status = "cancelled"
      graph.completedAt = now

      for (const node of graph.nodes.values()) {
        if (isTerminal(node.status)) continue
        node.status = "cancelled"
        node.completedAt = now
      }

      const cancelled = cloneGraph(graph)
      data.graphs.delete(graphID)
      yield* cleanupParent(graph.parentSessionID)
      yield* Effect.forEach(running, (sessionID) => runState.cancel(sessionID), {
        concurrency: "unbounded",
        discard: true,
      })
      return cancelled
    })

    return Service.of({ submit, list, get, cancel, findBySession })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(SessionRunState.defaultLayer),
)

export * as SessionTaskGraph from "./task-graph"