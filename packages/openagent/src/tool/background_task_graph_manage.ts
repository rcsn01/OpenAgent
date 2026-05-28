import { Effect, Schema } from "effect"
import { SessionTaskGraph } from "../session/task-graph"
import { TaskGraphID } from "../session/schema"
import * as Tool from "./tool"

type NodeSummary = {
  nodeId: string
  description: string
  agent: string
  status: SessionTaskGraph.NodeStatus
  dependencies: string[]
  sessionId?: string
  blockedBy?: string[]
}

type GraphSummary = {
  graphId: string
  status: SessionTaskGraph.GraphStatus
  createdAt: number
  completedAt?: number
  nodes: NodeSummary[]
}

type ListMetadata = {
  count: number
  graphs: GraphSummary[]
}

type GetMetadata = {
  found: boolean
  graphId: string
  graph?: GraphSummary
}

type CancelMetadata = {
  found: boolean
  graphId: string
  cancelled: boolean
  graph?: GraphSummary
}

const LIST_DESCRIPTION =
  "List background task graphs for the current session. Use this for concrete inspection after compaction or when the user explicitly asks for graph status, not as a polling loop."

const GET_DESCRIPTION =
  "Get the current status and node details for one background task graph by graph_id. Use this for targeted inspection, not repeated polling."

const CANCEL_DESCRIPTION =
  "Cancel a background task graph by graph_id. Use this when the dependency-aware delegated work should stop and no further automatic delivery is desired."

function summarize(graph: SessionTaskGraph.Info): GraphSummary {
  return {
    graphId: graph.graphID,
    status: graph.status,
    createdAt: graph.createdAt,
    completedAt: graph.completedAt,
    nodes: graph.nodes.map((node) => ({
      nodeId: node.nodeID,
      description: node.description,
      agent: node.agent,
      status: node.status,
      dependencies: [...node.dependencies],
      sessionId: node.sessionID,
      blockedBy: node.blockedBy ? [...node.blockedBy] : undefined,
    })),
  }
}

function renderNode(node: SessionTaskGraph.NodeInfo) {
  return [
    `<background_task_node id="${node.nodeID}" agent="${node.agent}" status="${node.status}">`,
    `description: ${node.description}`,
    ...(node.dependencies.length ? [`dependencies: ${node.dependencies.join(", ")}`] : []),
    ...(node.sessionID ? [`task_id: ${node.sessionID}`] : []),
    ...(node.blockedBy?.length ? [`blocked_by: ${node.blockedBy.join(", ")}`] : []),
    ...(node.title ? [`title: ${node.title}`] : []),
    ...(node.error ? [`error: ${node.error}`] : []),
    ...(node.output ? ["<task_result>", node.output, "</task_result>"] : []),
    "</background_task_node>",
  ].join("\n")
}

function renderGraph(graph: SessionTaskGraph.Info) {
  return [
    `<background_task_graph id="${graph.graphID}" status="${graph.status}">`,
    `created_at: ${graph.createdAt}`,
    ...(graph.completedAt ? [`completed_at: ${graph.completedAt}`] : []),
    ...graph.nodes.map((node) => renderNode(node)),
    "</background_task_graph>",
  ].join("\n")
}

const EmptyParameters = Schema.Struct({})

const GetParameters = Schema.Struct({
  graph_id: Schema.String.annotate({ description: "The graph_id returned when the background task graph was submitted." }),
})

const CancelParameters = Schema.Struct({
  graph_id: Schema.String.annotate({ description: "The graph_id of the background task graph to cancel." }),
})

export const BackgroundTaskGraphListTool = Tool.define<typeof EmptyParameters, ListMetadata, SessionTaskGraph.Service>(
  "background_task_graph_list",
  Effect.gen(function* () {
    const graph = yield* SessionTaskGraph.Service

    return {
      description: LIST_DESCRIPTION,
      parameters: EmptyParameters,
      execute: (_params: Schema.Schema.Type<typeof EmptyParameters>, ctx: Tool.Context<ListMetadata>) =>
        Effect.gen(function* () {
          const graphs = (yield* graph.list(ctx.sessionID)).filter((item) => item.origin === "background_task_graph")
          return {
            title: `${graphs.length} background graph${graphs.length === 1 ? "" : "s"}`,
            output:
              graphs.length === 0
                ? "No background task graphs are currently tracked for this session."
                : graphs.map((item) => renderGraph(item)).join("\n\n"),
            metadata: {
              count: graphs.length,
              graphs: graphs.map((item) => summarize(item)),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const BackgroundTaskGraphGetTool = Tool.define<typeof GetParameters, GetMetadata, SessionTaskGraph.Service>(
  "background_task_graph_get",
  Effect.gen(function* () {
    const graph = yield* SessionTaskGraph.Service

    return {
      description: GET_DESCRIPTION,
      parameters: GetParameters,
      execute: (params: Schema.Schema.Type<typeof GetParameters>, ctx: Tool.Context<GetMetadata>) =>
        Effect.gen(function* () {
          const item = yield* graph.get(TaskGraphID.make(params.graph_id))
          if (!item || item.parentSessionID !== ctx.sessionID || item.origin !== "background_task_graph") {
            return {
              title: "Background task graph not found",
              output:
                "No tracked background task graph with that graph_id was found for this session. It may have already been delivered, cancelled, or never existed.",
              metadata: {
                found: false,
                graphId: params.graph_id,
                graph: undefined,
              },
            }
          }

          return {
            title: `${item.nodes.length} node background graph`,
            output: renderGraph(item),
            metadata: {
              found: true,
              graphId: params.graph_id,
              graph: summarize(item),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const BackgroundTaskGraphCancelTool = Tool.define<typeof CancelParameters, CancelMetadata, SessionTaskGraph.Service>(
  "background_task_graph_cancel",
  Effect.gen(function* () {
    const graph = yield* SessionTaskGraph.Service

    return {
      description: CANCEL_DESCRIPTION,
      parameters: CancelParameters,
      execute: (params: Schema.Schema.Type<typeof CancelParameters>, ctx: Tool.Context<CancelMetadata>) =>
        Effect.gen(function* () {
          const item = yield* graph.get(TaskGraphID.make(params.graph_id))
          if (!item || item.parentSessionID !== ctx.sessionID || item.origin !== "background_task_graph") {
            return {
              title: "Background task graph not found",
              output:
                "No tracked background task graph with that graph_id was found for this session. It may have already been delivered, cancelled, or never existed.",
              metadata: {
                found: false,
                graphId: params.graph_id,
                cancelled: false,
                graph: undefined,
              },
            }
          }

          const agents = [...new Set(item.nodes.map((node) => node.agent))]
          yield* ctx.ask({
            permission: "task",
            patterns: agents,
            always: agents,
            metadata: {
              graph_id: params.graph_id,
              node_count: item.nodes.length,
              subagent_types: agents,
            },
          })

          const cancelled = yield* graph.cancel(item.graphID)
          if (!cancelled) {
            return {
              title: "Background task graph not found",
              output:
                "The background task graph disappeared before it could be cancelled. It may have completed or been removed already.",
              metadata: {
                found: false,
                graphId: params.graph_id,
                cancelled: false,
                graph: undefined,
              },
            }
          }

          return {
            title: `Cancelled ${cancelled.nodes.length} node background graph`,
            output: [
              `graph_id: ${cancelled.graphID}`,
              `status: cancelled`,
              `nodes: ${cancelled.nodes.length}`,
            ].join("\n"),
            metadata: {
              found: true,
              graphId: params.graph_id,
              cancelled: true,
              graph: summarize(cancelled),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)