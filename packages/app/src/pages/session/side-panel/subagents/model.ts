import type { Session, SessionGraphsResponse } from "@opencode-ai/ui/contracts"

export type SubagentSelection =
  | {
      type: "node"
      graphID: string
      nodeID: string
    }
  | {
      type: "session"
      sessionID: string
    }

export type SubagentGraph = SessionGraphsResponse["graphs"][number]
export type SubagentNode = SubagentGraph["nodes"][number]

export type SubagentNodeRow = {
  key: string
  graphID: string
  node: SubagentNode
  session?: Session
}

export type SubagentGraphGroup = {
  graph: SubagentGraph
  nodes: SubagentNodeRow[]
}

export type SubagentPanelModel = {
  rootSessionID: string
  graphs: SubagentGraphGroup[]
  childSessions: Session[]
  ungrouped: Session[]
  defaultSelection?: SubagentSelection
  summary: {
    graphs: number
    children: number
    active: number
    running: number
    failed: number
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function buildSubagentsPanelModel(input: {
  sessionID: string
  sessions: Session[]
  response?: SessionGraphsResponse
}): SubagentPanelModel {
  const current = input.sessions.find((item) => item.id === input.sessionID)
  const rootSessionID = input.response?.rootSessionID ?? current?.parentID ?? current?.id ?? input.sessionID
  const childSessions = input.sessions
    .filter((item) => item.parentID === rootSessionID)
    .toSorted((a, b) => a.time.created - b.time.created)
  const sessionsByID = new Map(childSessions.map((item) => [item.id, item]))
  const represented = new Set<string>()

  const graphs = (input.response?.graphs ?? [])
    .toSorted((a, b) => finiteNumber(b.createdAt) - finiteNumber(a.createdAt))
    .map((graph) => ({
      graph,
      nodes: graph.nodes.map((node) => {
        if (node.sessionID) represented.add(node.sessionID)
        return {
          key: `${graph.graphID}:${node.nodeID}`,
          graphID: graph.graphID,
          node,
          session: node.sessionID ? sessionsByID.get(node.sessionID) : undefined,
        }
      }),
    }))

  const focusGraph = graphs.find((item) => item.graph.graphID === input.response?.focusGraphID) ?? graphs[0]
  const focusNode =
    focusGraph?.nodes.find((item) => item.node.sessionID === input.sessionID) ??
    focusGraph?.nodes.find((item) => item.node.status === "running") ??
    focusGraph?.nodes.find((item) => item.node.status === "failed" || item.node.status === "blocked") ??
    focusGraph?.nodes[0]
  const defaultSelection = focusNode
    ? ({
        type: "node",
        graphID: focusNode.graphID,
        nodeID: focusNode.node.nodeID,
      } satisfies SubagentSelection)
    : childSessions[0]
      ? ({
          type: "session",
          sessionID: childSessions[0].id,
        } satisfies SubagentSelection)
      : undefined

  return {
    rootSessionID,
    graphs,
    childSessions,
    ungrouped: childSessions.filter((item) => !represented.has(item.id)),
    defaultSelection,
    summary: {
      graphs: graphs.length,
      children: childSessions.length,
      active: graphs.filter((item) => item.graph.status === "active").length,
      running: graphs.reduce((sum, item) => sum + item.nodes.filter((node) => node.node.status === "running").length, 0),
      failed: graphs.reduce(
        (sum, item) =>
          sum + item.nodes.filter((node) => node.node.status === "failed" || node.node.status === "blocked").length,
        0,
      ),
    },
  }
}
