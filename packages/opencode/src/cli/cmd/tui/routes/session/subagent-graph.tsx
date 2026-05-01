import { useEvent } from "@tui/context/event"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { tint, useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import { errorMessage } from "@/util/error"
import * as Locale from "@/util/locale"
import { getScrollAcceleration } from "../../util/scroll"
import { useTuiConfig } from "@tui/context/tui-config"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"

type PositionedNode = {
  node: GraphNode
  depth: number
  row: number
  x: number
  y: number
  width: number
  height: number
}

type DiagramConnectorCell = {
  char: string
  edgeKeys: string[]
}

type DiagramColumn = {
  depth: number
  x: number
  width: number
  label: string
  detail: string
}

type DiagramLayout = {
  width: number
  height: number
  columns: DiagramColumn[]
  connectorRows: (DiagramConnectorCell | undefined)[][]
  edgeCount: number
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

const GraphBorderChars = {
  topLeft: "┌",
  bottomLeft: "└",
  vertical: "│",
  topRight: "┐",
  bottomRight: "┘",
  horizontal: "─",
  bottomT: "┴",
  topT: "┬",
  cross: "┼",
  leftT: "├",
  rightT: "┤",
}

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
  return theme.border
}

function formatTimestamp(value?: number) {
  if (!value) return "-"
  return Locale.time(value)
}

function truncateLabel(input: string, width: number) {
  if (input.length <= width) return input
  if (width <= 1) return input.slice(0, width)
  if (width <= 3) return input.slice(0, width)
  return `${input.slice(0, width - 1)}…`
}

function average(values: number[]) {
  if (values.length === 0) return
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function padLabel(input: string, width: number) {
  return truncateLabel(input, width).padEnd(width, " ")
}

function centerLabel(input: string, width: number) {
  const truncated = truncateLabel(input, width)
  const padding = Math.max(0, width - truncated.length)
  return `${" ".repeat(Math.floor(padding / 2))}${truncated}`.padEnd(width, " ")
}

function edgeKey(sourceID: string, targetID: string) {
  return `${sourceID}->${targetID}`
}

function edgeNodes(input: string) {
  const separator = input.indexOf("->")
  if (separator === -1) return { sourceID: input, targetID: input }
  return {
    sourceID: input.slice(0, separator),
    targetID: input.slice(separator + 2),
  }
}

function nodeFlowLabel(dependencyCount: number, dependentCount: number) {
  if (dependencyCount === 0 && dependentCount === 0) return "isolated"
  if (dependencyCount === 0) return `root · out ${dependentCount}`
  if (dependentCount === 0) return `deps ${dependencyCount} · leaf`
  return `deps ${dependencyCount} · out ${dependentCount}`
}

function nodeKey(graphID: string, nodeID: string) {
  return `${graphID}:${nodeID}`
}

function nodeBadge(node: GraphNode, currentSessionID: string) {
  if (node.sessionID === currentSessionID) return "◎"
  if (node.status === "running") return "▶"
  if (node.status === "completed") return "●"
  if (node.status === "failed" || node.status === "blocked") return "!"
  if (node.status === "cancelled") return "×"
  return "○"
}

function nodeStatusLabel(status: GraphNode["status"]) {
  if (status === "completed") return "done"
  return status
}

function graphSummary(graphs: GraphInfo[]) {
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

function nodeSummary(graph: GraphInfo) {
  return graph.nodes.reduce(
    (acc, node) => {
      acc[node.status] += 1
      return acc
    },
    {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
      cancelled: 0,
    },
  )
}

function preferredGraphID(response?: GraphResponse) {
  if (!response?.graphs.length) return
  if (response.focusGraphID && response.graphs.some((graph) => graph.graphID === response.focusGraphID)) {
    return response.focusGraphID
  }
  return response.graphs.at(-1)?.graphID ?? response.graphs[0]?.graphID
}

function preferredNodeID(graph: GraphInfo, currentSessionID: string) {
  return (
    graph.nodes.find((node) => node.sessionID === currentSessionID)?.nodeID ??
    graph.nodes.find((node) => node.status === "running")?.nodeID ??
    graph.nodes.find((node) => node.status === "failed" || node.status === "blocked")?.nodeID ??
    graph.nodes[0]?.nodeID
  )
}

function mergeConnectorCell(current: string, next: string) {
  if (current === " ") return next
  if (next === " ") return current
  if (current === next) return current
  if (next === "▼" || next === "▶") return next
  if (current === "▼" || current === "▶") return current
  if ((current === "│" && next === "─") || (current === "─" && next === "│")) return "┼"
  if (current === "┼" || next === "┼") return "┼"
  return next
}

function connectorRowSegments(
  row: (DiagramConnectorCell | undefined)[],
  theme: ReturnType<typeof useTheme>["theme"],
  selectedNodeID?: string,
) {
  const segments: Array<{ text: string; color: typeof theme.border }> = []
  let buffer = ""
  let color = theme.text

  row.forEach((cell) => {
    const nextColor =
      cell &&
      selectedNodeID &&
      cell.edgeKeys.some((key) => {
        const edge = edgeNodes(key)
        return edge.sourceID === selectedNodeID || edge.targetID === selectedNodeID
      })
        ? theme.primary
        : theme.text

    if (nextColor !== color) {
      if (buffer) segments.push({ text: buffer, color })
      buffer = cell?.char ?? " "
      color = nextColor
      return
    }

    buffer += cell?.char ?? " "
  })

  if (buffer) segments.push({ text: buffer, color })
  return segments
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

  const depthCount = Math.max(...graph.nodes.map((node) => depthOf(node)), 0) + 1
  const layers = Array.from({ length: depthCount }, () => [] as GraphNode[])
  graph.nodes.forEach((node) => {
    layers[depthOf(node)]?.push(node)
  })

  const rowHint = new Map<string, number>()
  const orderedLayers = layers.map((nodes) => {
    const ordered = [...nodes].sort((left, right) => {
      const leftHint = average(
        left.dependencies.flatMap((dependency) => {
          const row = rowHint.get(dependency)
          return row === undefined ? [] : [row]
        }),
      ) ?? Number.MAX_SAFE_INTEGER
      const rightHint = average(
        right.dependencies.flatMap((dependency) => {
          const row = rowHint.get(dependency)
          return row === undefined ? [] : [row]
        }),
      ) ?? Number.MAX_SAFE_INTEGER
      return leftHint - rightHint || left.createdAt - right.createdAt || left.nodeID.localeCompare(right.nodeID)
    })
    ordered.forEach((node, index) => rowHint.set(node.nodeID, index))
    return ordered
  })

  const maxColumns = Math.max(...orderedLayers.map((layer) => layer.length), 1)
  const nodeHeight = 5
  const verticalGap = 3
  const gapFloor = availableWidth >= 100 ? 6 : 4
  const nodeWidth = Math.max(
    18,
    Math.min(28, Math.floor((availableWidth - Math.max(0, maxColumns - 1) * gapFloor) / maxColumns)),
  )
  const horizontalGap = maxColumns > 1 ? Math.max(gapFloor, Math.floor((availableWidth - nodeWidth * maxColumns) / (maxColumns - 1))) : 0
  const totalWidth = maxColumns * nodeWidth + Math.max(0, maxColumns - 1) * horizontalGap
  const width = Math.max(availableWidth, totalWidth)
  const height = depthCount * nodeHeight + Math.max(0, depthCount - 1) * verticalGap
  const canvas = Array.from({ length: height }, () => Array<DiagramConnectorCell | undefined>(width).fill(undefined))

  const placed = orderedLayers.flatMap((layer, depth) => {
    const layerWidth = layer.length * nodeWidth + Math.max(0, layer.length - 1) * horizontalGap
    const xOffset = Math.max(0, Math.floor((width - layerWidth) / 2))
    return layer.map((node, index) => ({
      node,
      depth,
      row: index,
      x: xOffset + index * (nodeWidth + horizontalGap),
      y: depth * (nodeHeight + verticalGap),
      width: nodeWidth,
      height: nodeHeight,
    }))
  })
  const placedByID = new Map(placed.map((item) => [item.node.nodeID, item]))

  const put = (x: number, y: number, char: string, sourceID: string, targetID: string) => {
    if (x < 0 || y < 0 || y >= canvas.length || x >= canvas[y]!.length) return
    const current = canvas[y]![x]
    const key = edgeKey(sourceID, targetID)
    canvas[y]![x] = {
      char: mergeConnectorCell(current?.char ?? " ", char),
      edgeKeys: current?.edgeKeys.includes(key) ? current.edgeKeys : [...(current?.edgeKeys ?? []), key],
    }
  }

  const drawHorizontal = (y: number, from: number, to: number, sourceID: string, targetID: string) => {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    for (let x = start; x <= end; x++) put(x, y, "─", sourceID, targetID)
  }

  const drawVertical = (x: number, from: number, to: number, sourceID: string, targetID: string) => {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    for (let y = start; y <= end; y++) put(x, y, "│", sourceID, targetID)
  }

  placed.forEach((target) => {
    target.node.dependencies.forEach((dependency) => {
      const source = placedByID.get(dependency)
      if (!source) return
      const sourceX = source.x + Math.floor(source.width / 2)
      const sourceY = source.y + source.height
      const targetX = target.x + Math.floor(target.width / 2)
      const targetY = target.y - 1
      const junctionY = Math.max(sourceY, target.y - 2)

      drawVertical(sourceX, sourceY, junctionY, dependency, target.node.nodeID)
      if (sourceX !== targetX) drawHorizontal(junctionY, sourceX, targetX, dependency, target.node.nodeID)
      if (targetY - 1 >= junctionY) drawVertical(targetX, junctionY, targetY - 1, dependency, target.node.nodeID)
      put(targetX, targetY, "▼", dependency, target.node.nodeID)
    })
  })

  return {
    width,
    height,
    columns: [],
    connectorRows: canvas,
    edgeCount: graph.nodes.reduce((sum, node) => sum + node.dependencies.length, 0),
    nodes: placed,
  }
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

function GraphDiagram(props: {
  graphID: string
  layout: DiagramLayout
  currentSessionID: string
  selectedNodeKey?: string
  theme: ReturnType<typeof useTheme>["theme"]
  onSelect: (nodeID: string) => void
}) {
  const selectedNodeID = createMemo(() =>
    props.selectedNodeKey?.startsWith(`${props.graphID}:`) ? props.selectedNodeKey.slice(props.graphID.length + 1) : undefined,
  )
  const dependentCounts = createMemo(() =>
    props.layout.nodes.reduce((acc, placed) => {
      placed.node.dependencies.forEach((dependency) => {
        acc.set(dependency, (acc.get(dependency) ?? 0) + 1)
      })
      return acc
    }, new Map<string, number>()),
  )
  const directDependencies = createMemo(() => {
    const nodeID = selectedNodeID()
    if (!nodeID) return new Set<string>()
    const node = props.layout.nodes.find((placed) => placed.node.nodeID === nodeID)?.node
    return new Set(node?.dependencies ?? [])
  })
  const directDependents = createMemo(() => {
    const nodeID = selectedNodeID()
    if (!nodeID) return new Set<string>()
    return new Set(
      props.layout.nodes.flatMap((placed) => (placed.node.dependencies.includes(nodeID) ? [placed.node.nodeID] : [])),
    )
  })

  return (
    <box width={props.layout.width} height={props.layout.height} position="relative" backgroundColor={props.theme.background}>
      <box position="absolute" top={0} left={0} width={props.layout.width} height={props.layout.height} flexDirection="column">
        <For each={props.layout.connectorRows}>
          {(row) => (
            <text wrapMode="none">
              <For each={connectorRowSegments(row, props.theme, selectedNodeID())}>
                {(segment) => <span style={{ fg: segment.color }}>{segment.text}</span>}
              </For>
            </text>
          )}
        </For>
      </box>

      <For each={props.layout.columns}>
        {(column) => (
          <box position="absolute" top={0} left={column.x} width={column.width} height={2} flexDirection="column">
            <text fg={props.theme.textMuted} wrapMode="none">
              {centerLabel(column.label, column.width)}
            </text>
            <text fg={props.theme.textMuted} wrapMode="none">
              {centerLabel(column.detail, column.width)}
            </text>
          </box>
        )}
      </For>

      <For each={props.layout.nodes}>
        {(placed) => {
          const selected = () => props.selectedNodeKey === nodeKey(props.graphID, placed.node.nodeID)
          const current = () => placed.node.sessionID === props.currentSessionID
          const upstream = () => directDependencies().has(placed.node.nodeID)
          const downstream = () => directDependents().has(placed.node.nodeID)
          const innerWidth = Math.max(1, placed.width - 2)
          const label = () => padLabel(`${nodeBadge(placed.node, props.currentSessionID)} ${placed.node.title ?? placed.node.nodeID}`, innerWidth)
          const meta = () => padLabel(`${nodeStatusLabel(placed.node.status)} · @${placed.node.agent}`, innerWidth)
          const flow = () =>
            padLabel(nodeFlowLabel(placed.node.dependencies.length, dependentCounts().get(placed.node.nodeID) ?? 0), innerWidth)
          const backgroundColor = () => {
            if (selected()) return tint(props.theme.backgroundPanel, props.theme.primary, 0.18)
            if (current()) return tint(props.theme.backgroundPanel, props.theme.info, 0.14)
            if (upstream()) return tint(props.theme.backgroundPanel, props.theme.info, 0.12)
            if (downstream()) return tint(props.theme.backgroundPanel, props.theme.warning, 0.12)
            return props.theme.backgroundPanel
          }
          const borderColor = () => {
            if (selected()) return props.theme.primary
            if (upstream()) return props.theme.info
            if (downstream()) return props.theme.warning
            return nodeStatusColor(props.theme, placed.node.status)
          }

          return (
            <box
              position="absolute"
              left={placed.x}
              top={placed.y}
              width={placed.width}
              height={placed.height}
              border
              borderColor={borderColor()}
              customBorderChars={GraphBorderChars}
              backgroundColor={backgroundColor()}
              onMouseUp={() => props.onSelect(placed.node.nodeID)}
            >
              <box flexDirection="column">
                <text fg={props.theme.text} wrapMode="none">
                  {label()}
                </text>
                <text fg={selected() ? props.theme.text : props.theme.textMuted} wrapMode="none">
                  {meta()}
                </text>
                <text fg={selected() || upstream() || downstream() ? props.theme.text : props.theme.textMuted} wrapMode="none">
                  {flow()}
                </text>
              </box>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function NodeInspector(props: {
  graph?: GraphInfo
  node?: GraphNode
  currentSessionID: string
  theme: ReturnType<typeof useTheme>["theme"]
  onOpenSession: (sessionID: string) => void
}) {
  if (!props.graph || !props.node) {
    return (
      <box flexDirection="column" gap={1}>
        <text fg={props.theme.text}>
          <b>Inspector</b>
        </text>
        <text fg={props.theme.textMuted} wrapMode="word">
          Select a node to inspect its dependencies, timing, and child session link.
        </text>
      </box>
    )
  }

  const isCurrent = props.node.sessionID === props.currentSessionID
  const sessionID = props.node.sessionID
  const dependents = props.graph.nodes
    .filter((candidate) => candidate.dependencies.includes(props.node!.nodeID))
    .map((candidate) => candidate.nodeID)

  return (
    <box flexDirection="column" gap={1}>
      <text fg={props.theme.text}>
        <b>Inspector</b>
      </text>

      <box flexDirection="column" gap={1}>
        <text fg={props.theme.text} wrapMode="word">
          <b>{props.node.title ?? props.node.nodeID}</b>
        </text>
        <text fg={props.theme.textMuted} wrapMode="word">
          {props.node.nodeID} · @{props.node.agent}
          <Show when={isCurrent}>
            <span style={{ fg: props.theme.primary }}> · current session</span>
          </Show>
        </text>
        <text fg={nodeStatusColor(props.theme, props.node.status)}>{props.node.status}</text>
      </box>

      <text fg={props.theme.textMuted} wrapMode="word">
        {props.node.description}
      </text>

      <text fg={props.theme.textMuted} wrapMode="word">
        depends on {props.node.dependencies.length > 0 ? props.node.dependencies.join(", ") : "nothing"}
      </text>

      <text fg={props.theme.textMuted} wrapMode="word">
        unblocks {dependents.length > 0 ? dependents.join(", ") : "nothing"}
      </text>

      <Show when={(props.node.blockedBy?.length ?? 0) > 0}>
        <text fg={props.theme.error} wrapMode="word">
          blocked by {props.node.blockedBy?.join(", ")}
        </text>
      </Show>

      <text fg={props.theme.textMuted} wrapMode="word">
        created {formatTimestamp(props.node.createdAt)}
        <Show when={props.node.startedAt}>
          <span> · started {formatTimestamp(props.node.startedAt)}</span>
        </Show>
        <Show when={props.node.completedAt}>
          <span> · finished {formatTimestamp(props.node.completedAt)}</span>
        </Show>
      </text>

      <Show when={props.node.error}>
        <text fg={props.theme.error} wrapMode="word">
          {props.node.error}
        </text>
      </Show>

      <Show when={props.node.output}>
        <text fg={props.theme.textMuted} wrapMode="word">
          {props.node.output}
        </text>
      </Show>

      <Show when={sessionID}>
        <text fg={props.theme.primary} wrapMode="word" onMouseUp={() => props.onOpenSession(sessionID!)}>
          Open session {sessionID}
        </text>
      </Show>

      <text fg={props.theme.textMuted} wrapMode="word">
        click nodes in the diagram to update this inspector
      </text>
    </box>
  )
}

export function SubagentGraphScreen(props: { sessionID: string }) {
  const sdk = useSDK()
  const route = useRoute()
  const event = useEvent()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const scrollbarOptions = createMemo(() => ({
    trackOptions: {
      backgroundColor: theme.backgroundPanel,
      foregroundColor: theme.borderActive,
    },
  }))

  const [graphs, { refetch }] = createResource(() => props.sessionID, (sessionID) => loadGraphs(sdk, sessionID))
  const [activeGraphID, setActiveGraphID] = createSignal<string | undefined>()
  const [selectedNodeKey, setSelectedNodeKey] = createSignal<string | undefined>()

  const goBack = () => {
    route.navigate({
      type: "session",
      sessionID: props.sessionID,
    })
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented || evt.name !== "escape") return
    if (renderer.getSelection()?.getSelectedText()) return
    goBack()
    evt.preventDefault()
    evt.stopPropagation()
  })

  const dispose = event.subscribe((evt) => {
    if (!refreshableEvents.has(evt.type)) return
    void refetch()
  })
  onCleanup(dispose)

  const overallSummary = createMemo(() => graphSummary(graphs()?.graphs ?? []))
  const wideLayout = createMemo(() => dimensions().width >= 120)
  const inspectorWidth = createMemo(() => (wideLayout() ? Math.min(42, Math.max(34, Math.floor(dimensions().width * 0.3))) : undefined))
  const diagramWidth = createMemo(() => {
    if (!wideLayout()) return Math.max(44, dimensions().width - 10)
    return Math.max(50, dimensions().width - (inspectorWidth() ?? 0) - 14)
  })

  createEffect(() => {
    const response = graphs()
    if (!response?.graphs.length) {
      setActiveGraphID(undefined)
      setSelectedNodeKey(undefined)
      return
    }
    if (response.graphs.some((graph) => graph.graphID === activeGraphID())) return
    const next = preferredGraphID(response)
    if (next) setActiveGraphID(next)
  })

  const activeGraph = createMemo(() => graphs()?.graphs.find((graph) => graph.graphID === activeGraphID()) ?? graphs()?.graphs[0])
  const activeNodeSummary = createMemo(() => {
    const graph = activeGraph()
    if (!graph) return
    return nodeSummary(graph)
  })
  const layout = createMemo(() => {
    const graph = activeGraph()
    if (!graph) return
    return renderGraphDiagram(graph, props.sessionID, diagramWidth())
  })

  createEffect(() => {
    const graph = activeGraph()
    if (!graph) {
      setSelectedNodeKey(undefined)
      return
    }
    if (graph.nodes.some((node) => nodeKey(graph.graphID, node.nodeID) === selectedNodeKey())) return
    const next = preferredNodeID(graph, props.sessionID)
    if (next) {
      setSelectedNodeKey(nodeKey(graph.graphID, next))
      return
    }
    setSelectedNodeKey(undefined)
  })

  const selectedNode = createMemo(() => {
    const graph = activeGraph()
    if (!graph) return
    return graph.nodes.find((node) => nodeKey(graph.graphID, node.nodeID) === selectedNodeKey()) ?? graph.nodes[0]
  })
  const relationshipHint = createMemo(() => {
    const graph = activeGraph()
    const node = selectedNode()
    if (!graph) return ""
    const edgeCount = graph.nodes.reduce((sum, item) => sum + item.dependencies.length, 0)
    if (edgeCount === 0) return "No dependency edges in this graph. All nodes are independent and can run in parallel."
    if (!node) return "Click a node to highlight its direct dependencies and dependents."
    const dependents = graph.nodes.filter((candidate) => candidate.dependencies.includes(node.nodeID)).map((candidate) => candidate.nodeID)
    if (node.dependencies.length === 0 && dependents.length === 0) {
      return `${node.title ?? node.nodeID} is isolated in this graph.`
    }
    return `${node.title ?? node.nodeID}: ${node.dependencies.length} upstream · ${dependents.length} downstream`
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="column"
      gap={1}
    >
      <box
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
        border={["bottom"]}
        customBorderChars={GraphBorderChars}
        borderColor={theme.border}
        paddingBottom={1}
      >
        <box>
          <text fg={theme.text}>
            <b>Subagent Graph</b>
            <span style={{ fg: theme.textMuted }}> · dependency diagram</span>
          </text>
          <text fg={theme.textMuted}>Session {props.sessionID}</text>
        </box>

        <text fg={theme.primary} onMouseUp={goBack}>
          back to session · esc
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
            <box flexGrow={1} alignItems="center" justifyContent="center">
              <text fg={theme.error} wrapMode="word">
                Failed to load task graphs: {errorMessage(graphs.error)}
              </text>
            </box>
          }
        >
          <box flexShrink={0} flexDirection="row" gap={2} flexWrap="wrap">
            <text fg={theme.text}>
              <b>{graphs()?.graphs.length ?? 0}</b> graphs
            </text>
            <text fg={theme.warning}>{overallSummary().active} active</text>
            <text fg={theme.success}>{overallSummary().completed} completed</text>
            <text fg={theme.error}>{overallSummary().failed} failed</text>
            <text fg={theme.textMuted}>{overallSummary().cancelled} cancelled</text>
            <Show when={graphs()?.focusGraphID}>
              <text fg={theme.textMuted}>focus {graphs()?.focusGraphID}</text>
            </Show>
          </box>

          <Show
            when={(graphs()?.graphs.length ?? 0) > 0}
            fallback={
              <box flexGrow={1} alignItems="center" justifyContent="center">
                <text fg={theme.textMuted} wrapMode="word">
                  No task graphs for this session yet. Start a graph-backed subagent task and reopen this screen.
                </text>
              </box>
            }
          >
            <Show when={(graphs()?.graphs.length ?? 0) > 1}>
              <box flexShrink={0} flexDirection="row" gap={1} flexWrap="wrap">
                <For each={graphs()?.graphs ?? []}>
                  {(graph) => {
                    const active = () => graph.graphID === activeGraphID()
                    const backgroundColor = () =>
                      active() ? tint(theme.backgroundPanel, theme.primary, 0.16) : theme.backgroundPanel

                    return (
                      <box
                        border
                        borderColor={active() ? theme.primary : theme.border}
                        customBorderChars={GraphBorderChars}
                        backgroundColor={backgroundColor()}
                        paddingLeft={1}
                        paddingRight={1}
                        onMouseUp={() => setActiveGraphID(graph.graphID)}
                      >
                        <text fg={active() ? theme.text : theme.textMuted}>
                          {truncateLabel(graph.graphID, 18)}
                          <span style={{ fg: graphStatusColor(theme, graph.status) }}> · {graph.status}</span>
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>

            <Show when={activeGraph()}>
              {(graph) => (
                <box flexGrow={1} minHeight={0} flexDirection={wideLayout() ? "row" : "column"} gap={1}>
                  <box
                    flexGrow={1}
                    minHeight={0}
                    border
                    borderColor={theme.border}
                    customBorderChars={GraphBorderChars}
                    paddingTop={1}
                    paddingBottom={1}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <box flexDirection="column" flexGrow={1} minHeight={0} gap={1}>
                      <box flexShrink={0} flexDirection="row" justifyContent="space-between" gap={2}>
                        <box>
                          <text fg={theme.text} wrapMode="word">
                            <b>{graph().graphID}</b>
                            <span style={{ fg: theme.textMuted }}> · {graph().origin}</span>
                          </text>
                          <text fg={theme.textMuted} wrapMode="word">
                            root {graph().parentSessionID} · created {formatTimestamp(graph().createdAt)}
                            <Show when={graph().completedAt}>
                              <span> · completed {formatTimestamp(graph().completedAt)}</span>
                            </Show>
                          </text>
                        </box>

                        <text fg={graphStatusColor(theme, graph().status)}>{graph().status}</text>
                      </box>

                      <box flexShrink={0} flexDirection="row" gap={2} flexWrap="wrap">
                        <Show when={activeNodeSummary()}>
                          {(summary) => (
                            <>
                              <text fg={theme.textMuted}>{summary().pending} pending</text>
                              <text fg={theme.warning}>{summary().running} running</text>
                              <text fg={theme.success}>{summary().completed} done</text>
                              <text fg={theme.error}>{summary().failed} failed</text>
                              <text fg={theme.error}>{summary().blocked} blocked</text>
                              <text fg={theme.textMuted}>{summary().cancelled} cancelled</text>
                            </>
                          )}
                        </Show>
                      </box>

                      <scrollbox
                        flexGrow={1}
                        minHeight={0}
                        paddingRight={1}
                        scrollAcceleration={scrollAcceleration()}
                        verticalScrollbarOptions={scrollbarOptions()}
                      >
                        <box flexDirection="column" gap={1} flexShrink={0}>
                          <text fg={theme.textMuted} wrapMode="word">
                            click a node to highlight its incoming and outgoing edges · ◎ marks the current session node
                          </text>
                          <text fg={layout()?.edgeCount === 0 ? theme.info : theme.textMuted} wrapMode="word">
                            {relationshipHint()}
                          </text>
                          <Show when={layout()}>
                            {(diagram) => (
                              <GraphDiagram
                                graphID={graph().graphID}
                                layout={diagram()}
                                currentSessionID={props.sessionID}
                                selectedNodeKey={selectedNodeKey()}
                                theme={theme}
                                onSelect={(nodeID) => setSelectedNodeKey(nodeKey(graph().graphID, nodeID))}
                              />
                            )}
                          </Show>
                        </box>
                      </scrollbox>
                    </box>
                  </box>

                  <box
                    flexShrink={0}
                    minHeight={0}
                    width={inspectorWidth()}
                    height={wideLayout() ? undefined : 14}
                    border
                    borderColor={theme.border}
                    customBorderChars={GraphBorderChars}
                    paddingTop={1}
                    paddingBottom={1}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <scrollbox
                      flexGrow={1}
                      minHeight={0}
                      paddingRight={1}
                      scrollAcceleration={scrollAcceleration()}
                      verticalScrollbarOptions={scrollbarOptions()}
                    >
                      <NodeInspector
                        graph={graph()}
                        node={selectedNode()}
                        currentSessionID={props.sessionID}
                        theme={theme}
                        onOpenSession={(sessionID) => {
                          route.navigate({
                            type: "session",
                            sessionID,
                          })
                        }}
                      />
                    </scrollbox>
                  </box>
                </box>
              )}
            </Show>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
