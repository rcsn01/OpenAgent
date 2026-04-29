import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useEvent } from "@tui/context/event"
import { useTuiConfig } from "@tui/context/tui-config"
import { Spinner } from "@tui/component/spinner"
import { errorMessage } from "@/util/error"
import { Locale } from "@/util"
import { getScrollAcceleration } from "../../util/scroll"
import { createMemo, createResource, For, onCleanup, onMount, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"

type PositionedNode = {
  node: GraphNode
  depth: number
  row: number
  x: number
  y: number
}

type DiagramLayout = {
  lines: string[]
  nodes: PositionedNode[]
}

type GraphNode = {
  graphID: string
  nodeID: string
  description: string
  agent: string
  dependencies: string[]
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled"
  sessionID?: string
  title?: string
  output?: string
  error?: string
  blockedBy?: string[]
  createdAt: number
  startedAt?: number
  completedAt?: number
}

type GraphInfo = {
  graphID: string
  parentSessionID: string
  origin: "background_task" | "background_task_graph"
  status: "active" | "completed" | "failed" | "cancelled"
  createdAt: number
  completedAt?: number
  nodes: GraphNode[]
}

type GraphResponse = {
  sessionID: string
  rootSessionID: string
  focusGraphID?: string
  graphs: GraphInfo[]
}

type RawClient = {
  get: (options: { url: string; path?: Record<string, unknown> }) => Promise<{
    data: GraphResponse | undefined
    error: unknown
  }>
}

const refreshableEvents = new Set(["message.part.updated", "session.updated", "session.deleted"])

function graphStatusColor(theme: ReturnType<typeof useTheme>["theme"], status: GraphInfo["status"]) {
  if (status === "active") return theme.warning
  if (status === "completed") return theme.success
  if (status === "failed") return theme.error
  return theme.textMuted
}

function nodeStatusColor(theme: ReturnType<typeof useTheme>["theme"], status: GraphNode["status"]) {
  if (status === "running") return theme.warning
  if (status === "completed") return theme.success
  if (status === "failed") return theme.error
  if (status === "blocked") return theme.error
  if (status === "cancelled") return theme.textMuted
  return theme.textMuted
}

function formatTimestamp(value?: number) {
  if (!value) return "-"
  return Locale.time(value)
}

function truncateLabel(input: string, width: number) {
  if (input.length <= width) return input
  if (width <= 3) return input.slice(0, width)
  return `${input.slice(0, width - 3)}...`
}

function average(values: number[]) {
  if (values.length === 0) return
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function padLabel(input: string, width: number) {
  return truncateLabel(input, width).padEnd(width, " ")
}

function nodeBadge(node: GraphNode, currentSessionID: string) {
  if (node.sessionID === currentSessionID) return "*"
  if (node.status === "running") return ">"
  if (node.status === "completed") return "+"
  if (node.status === "failed" || node.status === "blocked") return "!"
  if (node.status === "cancelled") return "x"
  return "o"
}

function mergeCell(current: string, next: string) {
  if (current === " ") return next
  if (next === " ") return current
  if (current === next) return current
  if (next === ">") return ">"
  if (current === ">") return current
  if ((current === "|" && next === "-") || (current === "-" && next === "|")) return "+"
  if (current === "+" || next === "+") return "+"
  return next
}

function renderGraphDiagram(graph: GraphInfo, currentSessionID: string, availableWidth: number): DiagramLayout {
  const byID = new Map(graph.nodes.map((node) => [node.nodeID, node]))
  const depthCache = new Map<string, number>()
  const depthOf = (node: GraphNode, stack = new Set<string>()): number => {
    const cached = depthCache.get(node.nodeID)
    if (cached !== undefined) return cached
    if (stack.has(node.nodeID)) return 0
    stack.add(node.nodeID)
    const depth =
      node.dependencies.length === 0
        ? 0
        : Math.max(
            ...node.dependencies.map((dependency) => {
              const source = byID.get(dependency)
              return source ? depthOf(source, new Set(stack)) + 1 : 0
            }),
          )
    depthCache.set(node.nodeID, depth)
    return depth
  }

  const depths = graph.nodes.map((node) => depthOf(node))
  const depthCount = Math.max(...depths, 0) + 1
  const layers = Array.from({ length: depthCount }, () => [] as GraphNode[])
  for (const node of graph.nodes) layers[depthOf(node)]?.push(node)

  const rowHint = new Map<string, number>()
  const orderedLayers = layers.map((nodes, depth) => {
    const ordered = [...nodes].sort((left, right) => {
      const leftHint = average(left.dependencies.flatMap((dependency) => {
        const row = rowHint.get(dependency)
        return row === undefined ? [] : [row]
      })) ?? Number.MAX_SAFE_INTEGER
      const rightHint = average(right.dependencies.flatMap((dependency) => {
        const row = rowHint.get(dependency)
        return row === undefined ? [] : [row]
      })) ?? Number.MAX_SAFE_INTEGER
      return leftHint - rightHint || left.createdAt - right.createdAt || left.nodeID.localeCompare(right.nodeID) || depth
    })
    ordered.forEach((node, index) => rowHint.set(node.nodeID, index))
    return ordered
  })

  const maxRows = Math.max(...orderedLayers.map((layer) => layer.length), 1)
  const minNodeWidth = 18
  const gapFloor = 6
  const nodeWidth = Math.max(
    minNodeWidth,
    Math.min(24, Math.floor((availableWidth - Math.max(0, depthCount - 1) * gapFloor) / depthCount)),
  )
  const horizontalGap = depthCount > 1 ? Math.max(gapFloor, Math.floor((availableWidth - nodeWidth * depthCount) / (depthCount - 1))) : 0
  const compact = nodeWidth <= 20
  const boxHeight = compact ? 4 : 5
  const verticalGap = 2
  const width = Math.max(
    availableWidth,
    depthCount * nodeWidth + Math.max(0, depthCount - 1) * horizontalGap,
  )
  const height = maxRows * (boxHeight + verticalGap) - verticalGap
  const canvas = Array.from({ length: height }, () => Array.from({ length: width }, () => " "))
  const placed = orderedLayers.flatMap((layer, depth) => {
    const offset = Math.floor((maxRows - layer.length) / 2)
    return layer.map((node, index) => ({
      node,
      depth,
      row: offset + index,
      x: depth * (nodeWidth + horizontalGap),
      y: (offset + index) * (boxHeight + verticalGap),
    }))
  })

  const put = (x: number, y: number, char: string) => {
    if (x < 0 || y < 0 || y >= canvas.length || x >= canvas[y]!.length) return
    canvas[y]![x] = mergeCell(canvas[y]![x]!, char)
  }

  const drawHorizontal = (y: number, from: number, to: number) => {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    for (let x = start; x <= end; x++) put(x, y, "-")
  }

  const drawVertical = (x: number, from: number, to: number) => {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    for (let y = start; y <= end; y++) put(x, y, "|")
  }

  for (const target of placed) {
    for (const dependency of target.node.dependencies) {
      const source = placed.find((item) => item.node.nodeID === dependency)
      if (!source) continue
      const sourceY = source.y + Math.floor(boxHeight / 2)
      const targetY = target.y + Math.floor(boxHeight / 2)
      const sourceX = source.x + nodeWidth
      const arrowX = target.x - 1
      const elbowX = Math.max(sourceX + 1, source.x + nodeWidth + Math.max(2, Math.floor(horizontalGap / 2)))
      drawHorizontal(sourceY, sourceX, elbowX)
      drawVertical(elbowX, sourceY, targetY)
      drawHorizontal(targetY, elbowX, arrowX - 1)
      put(arrowX, targetY, ">")
    }
  }

  for (const item of placed) {
    const top = item.y
    const left = item.x
    const innerWidth = Math.max(1, nodeWidth - 2)
    const title = padLabel(`${nodeBadge(item.node, currentSessionID)} ${item.node.nodeID}`, innerWidth)
    const meta = padLabel(compact ? item.node.status : `${item.node.status} @${item.node.agent}`, innerWidth)
    const detail = padLabel(compact ? truncateLabel(item.node.agent, innerWidth) : item.node.description, innerWidth)

    put(left, top, "+")
    put(left + nodeWidth - 1, top, "+")
    put(left, top + boxHeight - 1, "+")
    put(left + nodeWidth - 1, top + boxHeight - 1, "+")
    for (let x = left + 1; x < left + nodeWidth - 1; x++) {
      put(x, top, "-")
      put(x, top + boxHeight - 1, "-")
    }
    for (let y = top + 1; y < top + boxHeight - 1; y++) {
      put(left, y, "|")
      put(left + nodeWidth - 1, y, "|")
    }

    for (const [offset, char] of [...title].entries()) put(left + 1 + offset, top + 1, char)
    for (const [offset, char] of [...meta].entries()) put(left + 1 + offset, top + 2, char)
    if (boxHeight > 4) for (const [offset, char] of [...detail].entries()) put(left + 1 + offset, top + 3, char)
  }

  return {
    lines: canvas.map((line) => line.join("").replace(/\s+$/g, "")),
    nodes: placed.toSorted((left, right) => left.row - right.row || left.depth - right.depth),
  }
}

function statusSummary(graphs: GraphInfo[]) {
  return graphs.reduce(
    (acc, graph) => {
      acc[graph.status] += 1
      return acc
    },
    {
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
  )
}

async function loadGraphs(sdk: ReturnType<typeof useSDK>, sessionID: string) {
  const client = (sdk.client as unknown as { client: RawClient }).client
  const result = await client.get({
    url: "/session/{sessionID}/graphs",
    path: { sessionID },
  })
  if (result.error) throw result.error
  if (!result.data) throw new Error("No graph data returned")
  return result.data
}

export function DialogSubagentGraph(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const event = useEvent()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const scrollbarOptions = createMemo(() => ({
    trackOptions: {
      backgroundColor: theme.backgroundPanel,
      foregroundColor: theme.borderActive,
    },
  }))

  const [graphs, { refetch }] = createResource(
    () => props.sessionID,
    (sessionID) => loadGraphs(sdk, sessionID),
  )

  const summary = createMemo(() => statusSummary(graphs()?.graphs ?? []))
  const contentWidth = createMemo(() => Math.max(84, dimensions().width - 12))
  const wideLayout = createMemo(() => contentWidth() >= 132)
  const dialogHeight = createMemo(() => Math.max(30, dimensions().height - 6))
  const diagramWidth = createMemo(() => {
    if (!wideLayout()) return contentWidth() - 6
    return Math.max(56, contentWidth() - 44)
  })

  onMount(() => {
    dialog.setSize("xlarge")
  })

  const dispose = event.subscribe((evt) => {
    if (!refreshableEvents.has(evt.type)) return
    void refetch()
  })
  onCleanup(dispose)

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} height={dialogHeight()} flexDirection="column" gap={1}>
      <box flexShrink={0} flexDirection="row" justifyContent="space-between">
        <box>
          <text fg={theme.text}>
            <b>Subagent Graphs</b>
          </text>
          <text fg={theme.textMuted}>Live graph state for the current session tree</text>
        </box>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          close · esc
        </text>
      </box>

      <Show
        when={!graphs.loading}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <Spinner color={theme.textMuted}>Loading graphs</Spinner>
          </box>
        }
      >
        <Show
          when={!graphs.error}
          fallback={
            <box flexGrow={1} paddingTop={1}>
              <text fg={theme.error} wrapMode="word">
                Failed to load task graphs: {errorMessage(graphs.error)}
              </text>
            </box>
          }
        >
          <box flexShrink={0} flexDirection="row" gap={2} border={[
            "top",
            "bottom",
          ]} borderColor={theme.border} paddingTop={1} paddingBottom={1}>
            <text fg={theme.text}>
              <b>{graphs()?.graphs.length ?? 0}</b> graphs
            </text>
            <text fg={theme.warning}>{summary().active} active</text>
            <text fg={theme.success}>{summary().completed} completed</text>
            <text fg={theme.error}>{summary().failed} failed</text>
            <text fg={theme.textMuted}>{summary().cancelled} cancelled</text>
            <Show when={graphs()?.focusGraphID}>
              <text fg={theme.textMuted}>focus {graphs()?.focusGraphID}</text>
            </Show>
          </box>

          <Show
            when={(graphs()?.graphs.length ?? 0) > 0}
            fallback={
              <box flexGrow={1} paddingTop={1}>
                <text fg={theme.textMuted} wrapMode="word">
                  No task graphs for this session yet. Start a graph-backed subagent task and reopen this screen.
                </text>
              </box>
            }
          >
            <scrollbox
              flexGrow={1}
              minHeight={0}
              paddingRight={1}
              scrollAcceleration={scrollAcceleration()}
              verticalScrollbarOptions={scrollbarOptions()}
            >
              <box flexDirection="column" gap={1} flexShrink={0} paddingTop={1}>
                <For each={graphs()?.graphs ?? []}>
                  {(graph) => {
                    const isFocus = () => graphs()?.focusGraphID === graph.graphID
                    const layout = createMemo(() => renderGraphDiagram(graph, props.sessionID, diagramWidth()))
                    return (
                      <box
                        flexDirection="column"
                        gap={1}
                        border={["top"]}
                        borderColor={isFocus() ? theme.borderActive : theme.border}
                        paddingTop={1}
                      >
                        <box flexDirection="row" justifyContent="space-between" gap={2}>
                          <box>
                            <text fg={theme.text} wrapMode="word">
                              <b>{graph.graphID}</b>
                              <span style={{ fg: theme.textMuted }}> · {graph.origin}</span>
                              <Show when={isFocus()}>
                                <span style={{ fg: theme.primary }}> · current</span>
                              </Show>
                            </text>
                            <text fg={theme.textMuted} wrapMode="word">
                              Root {graph.parentSessionID} · created {formatTimestamp(graph.createdAt)}
                              <Show when={graph.completedAt}>
                                <span> · completed {formatTimestamp(graph.completedAt)}</span>
                              </Show>
                            </text>
                          </box>
                          <text fg={graphStatusColor(theme, graph.status)}>{graph.status}</text>
                        </box>

                        <box flexDirection={wideLayout() ? "row" : "column"} gap={2}>
                          <box
                            flexGrow={1}
                            backgroundColor={theme.backgroundPanel}
                            paddingLeft={1}
                            paddingRight={1}
                            paddingTop={1}
                            paddingBottom={1}
                            gap={1}
                          >
                            <text fg={theme.textMuted} wrapMode="word">
                              Diagram
                            </text>
                            <For each={layout().lines}>
                              {(line) => (
                                <text fg={theme.text} wrapMode="none">
                                  {line || " "}
                                </text>
                              )}
                            </For>
                            <text fg={theme.textMuted} wrapMode="word">
                              * current · &gt; running · + completed · ! failed/blocked · x cancelled · o pending
                            </text>
                          </box>

                          <box
                            flexDirection="column"
                            gap={1}
                            width={wideLayout() ? 38 : undefined}
                            flexShrink={0}
                          >
                            <text fg={theme.textMuted} wrapMode="word">
                              Nodes
                            </text>
                            <For each={layout().nodes}>
                              {(placed) => {
                                const node = () => placed.node
                                const isCurrent = () => node().sessionID === props.sessionID
                                return (
                                  <box
                                    flexDirection="column"
                                    gap={1}
                                    backgroundColor={isCurrent() ? theme.backgroundElement : theme.backgroundPanel}
                                    border={["left"]}
                                    borderColor={nodeStatusColor(theme, node().status)}
                                    paddingLeft={1}
                                    paddingRight={1}
                                    paddingTop={1}
                                    paddingBottom={1}
                                  >
                                    <box flexDirection="row" justifyContent="space-between" gap={2}>
                                      <box>
                                        <text fg={theme.text} wrapMode="word">
                                          <b>{node().nodeID}</b>
                                          <span style={{ fg: theme.textMuted }}> · {node().agent}</span>
                                          <Show when={isCurrent()}>
                                            <span style={{ fg: theme.primary }}> · current</span>
                                          </Show>
                                        </text>
                                        <text fg={theme.textMuted} wrapMode="word">
                                          layer {placed.depth + 1}
                                          <Show when={node().dependencies.length > 0}>
                                            <span> · deps {node().dependencies.join(", ")}</span>
                                          </Show>
                                        </text>
                                      </box>
                                      <text fg={nodeStatusColor(theme, node().status)}>{node().status}</text>
                                    </box>

                                    <text fg={theme.textMuted} wrapMode="word">
                                      {node().description}
                                    </text>

                                    <Show when={(node().blockedBy?.length ?? 0) > 0}>
                                      <text fg={theme.error} wrapMode="word">
                                        blocked by {node().blockedBy?.join(", ")}
                                      </text>
                                    </Show>

                                    <text fg={theme.textMuted} wrapMode="word">
                                      created {formatTimestamp(node().createdAt)}
                                      <Show when={node().startedAt}>
                                        <span> · started {formatTimestamp(node().startedAt)}</span>
                                      </Show>
                                      <Show when={node().completedAt}>
                                        <span> · finished {formatTimestamp(node().completedAt)}</span>
                                      </Show>
                                    </text>

                                    <Show when={node().title}>
                                      <text fg={theme.text} wrapMode="word">
                                        {node().title}
                                      </text>
                                    </Show>

                                    <Show when={node().error}>
                                      <text fg={theme.error} wrapMode="word">
                                        {node().error}
                                      </text>
                                    </Show>

                                    <Show when={node().sessionID}>
                                      <text
                                        fg={theme.primary}
                                        wrapMode="word"
                                        onMouseUp={() => {
                                          route.navigate({
                                            type: "session",
                                            sessionID: node().sessionID!,
                                          })
                                          dialog.clear()
                                        }}
                                      >
                                        Open session {node().sessionID}
                                      </text>
                                    </Show>
                                  </box>
                                )
                              }}
                            </For>
                          </box>
                        </box>

                        <Show when={!wideLayout()}>
                          <text fg={theme.textMuted} wrapMode="word">
                            Scroll for node details and click a session link to jump into that subagent.
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </box>
            </scrollbox>
          </Show>
        </Show>
      </Show>
    </box>
  )
}