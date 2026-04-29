import * as Tool from "./tool"
import DESCRIPTION from "./background_task_graph.txt"
import { MessageV2 } from "../session/message-v2"
import { SessionTaskGraph } from "../session/task-graph"
import { TaskExecution, type TaskPromptOps } from "../session/task-execution"
import { Effect, Schema } from "effect"

type NodeSummary = {
  nodeId: string
  description: string
  agent: string
  status: SessionTaskGraph.NodeStatus
  dependencies: string[]
  sessionId?: string
}

type GraphMetadata = {
  graphId: string
  status: SessionTaskGraph.GraphStatus
  runnable: number
  waiting: number
  running: number
  nodes: NodeSummary[]
}

const SharedGraphNodeParameters = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the node task." }),
  prompt: Schema.String.annotate({ description: "The delegated task prompt for this node." }),
  dependencies: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional node ids that must complete successfully before this node may start. Prefer `dependencies`; aliases `depends_on` and `dependsOn` are also accepted.",
  }),
  depends_on: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Compatibility alias for `dependencies`.",
  }),
  dependsOn: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Compatibility alias for `dependencies`.",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "Optional command that triggered this node." }),
}

const GraphNodeBySnakeCase = Schema.Struct({
  node_id: Schema.String.annotate({ description: "Stable node id within this graph. Prefer `node_id`." }),
  subagent_type: Schema.String.annotate({ description: "The specialized agent type to use for this node. Prefer `subagent_type`." }),
  ...SharedGraphNodeParameters,
})

const GraphNodeByCamelNodeId = Schema.Struct({
  nodeID: Schema.String.annotate({ description: "Compatibility alias for `node_id`." }),
  subagent_type: Schema.String.annotate({ description: "The specialized agent type to use for this node. Prefer `subagent_type`." }),
  ...SharedGraphNodeParameters,
})

const GraphNodeByShortId = Schema.Struct({
  id: Schema.String.annotate({ description: "Compatibility alias for `node_id`." }),
  subagent_type: Schema.String.annotate({ description: "The specialized agent type to use for this node. Prefer `subagent_type`." }),
  ...SharedGraphNodeParameters,
})

const GraphNodeByCamelAgent = Schema.Struct({
  node_id: Schema.String.annotate({ description: "Stable node id within this graph. Prefer `node_id`." }),
  subagentType: Schema.String.annotate({ description: "Compatibility alias for `subagent_type`." }),
  ...SharedGraphNodeParameters,
})

const GraphNodeByCamelIdAndAgent = Schema.Struct({
  nodeID: Schema.String.annotate({ description: "Compatibility alias for `node_id`." }),
  subagentType: Schema.String.annotate({ description: "Compatibility alias for `subagent_type`." }),
  ...SharedGraphNodeParameters,
})

const GraphNodeByShortIdAndCamelAgent = Schema.Struct({
  id: Schema.String.annotate({ description: "Compatibility alias for `node_id`." }),
  subagentType: Schema.String.annotate({ description: "Compatibility alias for `subagent_type`." }),
  ...SharedGraphNodeParameters,
})

const GraphNode = Schema.Union([
  GraphNodeBySnakeCase,
  GraphNodeByCamelNodeId,
  GraphNodeByShortId,
  GraphNodeByCamelAgent,
  GraphNodeByCamelIdAndAgent,
  GraphNodeByShortIdAndCamelAgent,
]).annotate({
  description:
    "Graph node input. Canonical keys are `node_id`, `subagent_type`, and `dependencies`. Compatibility aliases `nodeID`, `id`, `subagentType`, `depends_on`, and `dependsOn` are also accepted.",
})

export const Parameters = Schema.Struct({
  nodes: Schema.Array(GraphNode).annotate({ description: "The nodes to submit in one background task graph." }),
})

function nodeIDOf(node: Schema.Schema.Type<typeof GraphNode>) {
  if ("node_id" in node) return node.node_id
  if ("nodeID" in node) return node.nodeID
  return node.id
}

function nodeAgentOf(node: Schema.Schema.Type<typeof GraphNode>) {
  if ("subagent_type" in node) return node.subagent_type
  return node.subagentType
}

function nodeDependenciesOf(node: Schema.Schema.Type<typeof GraphNode>) {
  return node.dependencies ?? node.depends_on ?? node.dependsOn ?? []
}

function renderBackgroundTaskGraphPrompt(deliveries: SessionTaskGraph.Delivery[]) {
  return [
    "<system-reminder>",
    deliveries.length === 1
      ? "A background task graph you launched has new updates. Use them to continue helping the user."
      : "Multiple background task graphs you launched have new updates. Use them to continue helping the user.",
    "",
    ...deliveries.flatMap((delivery) => [
      `<background_task_graph id=\"${delivery.graphID}\" status=\"${delivery.status}\">`,
      ...delivery.nodes.flatMap((node) => [
        `<background_task_node id=\"${node.nodeID}\" agent=\"${node.agent}\" status=\"${node.status}\">`,
        `description: ${node.description}`,
        ...(node.sessionID ? [`task_id: ${node.sessionID}`] : []),
        ...(node.blockedBy?.length ? [`blocked_by: ${node.blockedBy.join(", ")}`] : []),
        ...(node.title ? [`title: ${node.title}`] : []),
        ...(node.status === "completed"
          ? ["<task_result>", node.output ?? "", "</task_result>"]
          : ["<task_error>", node.error ?? "Task failed", "</task_error>"]),
        "</background_task_node>",
        "",
      ]),
      "</background_task_graph>",
      "",
    ]),
    "Summarize the graph updates for the user and continue with your task.",
    "</system-reminder>",
  ].join("\n")
}

function summarize(graph: SessionTaskGraph.Info): GraphMetadata {
  const runnable = graph.nodes.filter((node) => node.status === "running").length
  const waiting = graph.nodes.filter((node) => node.status === "pending").length
  return {
    graphId: graph.graphID,
    status: graph.status,
    runnable,
    waiting,
    running: runnable,
    nodes: graph.nodes.map((node) => ({
      nodeId: node.nodeID,
      description: node.description,
      agent: node.agent,
      status: node.status,
      dependencies: [...node.dependencies],
      sessionId: node.sessionID,
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

export const BackgroundTaskGraphTool = Tool.define<typeof Parameters, GraphMetadata, SessionTaskGraph.Service | TaskExecution.Service>(
  "background_task_graph",
  Effect.gen(function* () {
    const graph = yield* SessionTaskGraph.Service
    const execution = yield* TaskExecution.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<GraphMetadata>) =>
        Effect.gen(function* () {
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) return yield* Effect.fail(new Error("background_task_graph requires promptOps in ctx.extra"))

          const assistantMessage = yield* Effect.sync(() =>
            MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }),
          )
          if (assistantMessage.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
          const assistant = assistantMessage.info

          const subagents = [...new Set(params.nodes.map((node) => nodeAgentOf(node)))]
          yield* ctx.ask({
            permission: "task",
            patterns: subagents,
            always: ["*"],
            metadata: {
              node_count: params.nodes.length,
              subagent_types: subagents,
            },
          })

          const submitted = yield* graph.submit({
            parentSessionID: ctx.sessionID,
            origin: "background_task_graph",
            deliver: (deliveries) =>
              ops
                .prompt({
                  sessionID: ctx.sessionID,
                  agent: assistant.agent,
                  model: {
                    modelID: assistant.modelID,
                    providerID: assistant.providerID,
                  },
                  variant: assistant.variant,
                  parts: [{ type: "text", text: renderBackgroundTaskGraphPrompt(deliveries), synthetic: true }],
                })
                .pipe(Effect.asVoid),
            nodes: params.nodes.map((node) => ({
              nodeID: nodeIDOf(node),
              description: node.description,
              agent: nodeAgentOf(node),
              dependencies: [...nodeDependenciesOf(node)],
              prepare: () =>
                execution.prepare({
                  task: {
                    description: node.description,
                    prompt: node.prompt,
                    subagent_type: nodeAgentOf(node),
                    command: node.command,
                  },
                  executionMode: "background",
                  parentSessionID: ctx.sessionID,
                  parentMessageID: ctx.messageID,
                  promptOps: ops,
                  ask: ctx.ask,
                  bypassAgentCheck: true,
                }).pipe(
                  Effect.map((prepared) => ({
                    sessionID: prepared.session.id,
                    run: prepared.run.pipe(
                      Effect.map((result) => ({
                        title: result.title,
                        output: result.output,
                      })),
                    ),
                  })),
                ),
            })),
          })

          const metadata = summarize(submitted)
          return {
            title: `${params.nodes.length} background graph node${params.nodes.length === 1 ? "" : "s"}`,
            output: [
              `graph_id: ${submitted.graphID}`,
              `status: ${submitted.status}`,
              `running: ${metadata.running}`,
              `waiting: ${metadata.waiting}`,
              "",
              ...submitted.nodes.map((node) => renderNode(node)),
            ].join("\n"),
            metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)