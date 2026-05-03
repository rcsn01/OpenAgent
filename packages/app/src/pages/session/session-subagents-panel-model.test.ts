import { describe, expect, test } from "bun:test"
import type { Session, SessionGraphsResponse } from "@opencode-ai/sdk/v2"
import { buildSubagentsPanelModel } from "./session-subagents-panel-model"

const session = (input: { id: string; parentID?: string; created?: number; title?: string }): Session => ({
  id: input.id,
  slug: input.id,
  projectID: "project",
  directory: "/repo",
  parentID: input.parentID,
  title: input.title ?? input.id,
  version: "0",
  time: {
    created: input.created ?? 0,
    updated: input.created ?? 0,
  },
})

const response = (input?: Partial<SessionGraphsResponse>): SessionGraphsResponse => ({
  sessionID: "root",
  rootSessionID: "root",
  graphs: [],
  ...input,
})

describe("buildSubagentsPanelModel", () => {
  test("maps graph nodes to child sessions by sessionID", () => {
    const model = buildSubagentsPanelModel({
      sessionID: "root",
      sessions: [session({ id: "root" }), session({ id: "child", parentID: "root" })],
      response: response({
        graphs: [
          {
            graphID: "graph",
            parentSessionID: "root",
            origin: "background_task_graph",
            status: "active",
            createdAt: 1,
            nodes: [
              {
                graphID: "graph",
                nodeID: "node",
                description: "do work",
                agent: "worker",
                dependencies: [],
                status: "running",
                sessionID: "child",
                createdAt: 1,
              },
            ],
          },
        ],
      }),
    })

    expect(model.graphs[0]?.nodes[0]?.session?.id).toBe("child")
    expect(model.ungrouped).toEqual([])
  })

  test("keeps child sessions that are not represented by graph nodes", () => {
    const model = buildSubagentsPanelModel({
      sessionID: "root",
      sessions: [
        session({ id: "root" }),
        session({ id: "graph-child", parentID: "root", created: 1 }),
        session({ id: "loose-child", parentID: "root", created: 2 }),
      ],
      response: response({
        graphs: [
          {
            graphID: "graph",
            parentSessionID: "root",
            origin: "background_task",
            status: "active",
            createdAt: 1,
            nodes: [
              {
                graphID: "graph",
                nodeID: "task",
                description: "graph child",
                agent: "explorer",
                dependencies: [],
                status: "running",
                sessionID: "graph-child",
                createdAt: 1,
              },
            ],
          },
        ],
      }),
    })

    expect(model.ungrouped.map((item) => item.id)).toEqual(["loose-child"])
    expect(model.summary.children).toBe(2)
  })

  test("prefers focused graph and current session node for default selection", () => {
    const model = buildSubagentsPanelModel({
      sessionID: "child-2",
      sessions: [
        session({ id: "root" }),
        session({ id: "child-1", parentID: "root" }),
        session({ id: "child-2", parentID: "root" }),
      ],
      response: response({
        sessionID: "child-2",
        focusGraphID: "focus",
        graphs: [
          {
            graphID: "other",
            parentSessionID: "root",
            origin: "background_task_graph",
            status: "active",
            createdAt: 1,
            nodes: [],
          },
          {
            graphID: "focus",
            parentSessionID: "root",
            origin: "background_task_graph",
            status: "active",
            createdAt: 2,
            nodes: [
              {
                graphID: "focus",
                nodeID: "first",
                description: "first",
                agent: "worker",
                dependencies: [],
                status: "running",
                sessionID: "child-1",
                createdAt: 2,
              },
              {
                graphID: "focus",
                nodeID: "current",
                description: "current",
                agent: "worker",
                dependencies: ["first"],
                status: "pending",
                sessionID: "child-2",
                createdAt: 3,
              },
            ],
          },
        ],
      }),
    })

    expect(model.defaultSelection).toEqual({ type: "node", graphID: "focus", nodeID: "current" })
  })

  test("preserves dependency and blocked-by details", () => {
    const model = buildSubagentsPanelModel({
      sessionID: "root",
      sessions: [session({ id: "root" })],
      response: response({
        graphs: [
          {
            graphID: "graph",
            parentSessionID: "root",
            origin: "background_task_graph",
            status: "failed",
            createdAt: 1,
            nodes: [
              {
                graphID: "graph",
                nodeID: "blocked",
                description: "blocked",
                agent: "worker",
                dependencies: ["setup"],
                status: "blocked",
                blockedBy: ["setup"],
                createdAt: 1,
              },
            ],
          },
        ],
      }),
    })

    expect(model.graphs[0]?.nodes[0]?.node.dependencies).toEqual(["setup"])
    expect(model.graphs[0]?.nodes[0]?.node.blockedBy).toEqual(["setup"])
    expect(model.summary.failed).toBe(1)
  })
})

