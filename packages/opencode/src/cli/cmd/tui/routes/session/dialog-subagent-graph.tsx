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

  onMount(() => {
    dialog.setSize("xlarge")
  })

  const dispose = event.subscribe((evt) => {
    if (!refreshableEvents.has(evt.type)) return
    void refetch()
  })
  onCleanup(dispose)

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} height={28} flexDirection="column" gap={1}>
      <box flexShrink={0} flexDirection="row" justifyContent="space-between">
        <box>
          <text fg={theme.text}>
            <b>Subagent Graphs</b>
          </text>
          <text fg={theme.textMuted}>Live graph state for the current session tree</text>
        </box>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
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

                        <For each={graph.nodes}>
                          {(node) => {
                            const isCurrent = () => node.sessionID === props.sessionID
                            return (
                              <box
                                flexDirection="column"
                                gap={1}
                                backgroundColor={isCurrent() ? theme.backgroundElement : undefined}
                                paddingLeft={1}
                                paddingRight={1}
                                paddingTop={1}
                                paddingBottom={1}
                              >
                                <box flexDirection="row" justifyContent="space-between" gap={2}>
                                  <box>
                                    <text fg={theme.text} wrapMode="word">
                                      <b>{node.nodeID}</b>
                                      <span style={{ fg: theme.textMuted }}> · {node.agent}</span>
                                      <Show when={isCurrent()}>
                                        <span style={{ fg: theme.primary }}> · current session</span>
                                      </Show>
                                    </text>
                                    <text fg={theme.textMuted} wrapMode="word">
                                      {node.description}
                                    </text>
                                  </box>
                                  <text fg={nodeStatusColor(theme, node.status)}>{node.status}</text>
                                </box>

                                <text fg={theme.textMuted} wrapMode="word">
                                  deps {node.dependencies.length > 0 ? node.dependencies.join(", ") : "none"}
                                  <Show when={node.blockedBy && node.blockedBy.length > 0}>
                                    <span> · blocked by {node.blockedBy?.join(", ")}</span>
                                  </Show>
                                </text>

                                <text fg={theme.textMuted} wrapMode="word">
                                  created {formatTimestamp(node.createdAt)}
                                  <Show when={node.startedAt}>
                                    <span> · started {formatTimestamp(node.startedAt)}</span>
                                  </Show>
                                  <Show when={node.completedAt}>
                                    <span> · finished {formatTimestamp(node.completedAt)}</span>
                                  </Show>
                                </text>

                                <Show when={node.title}>
                                  <text fg={theme.text} wrapMode="word">
                                    {node.title}
                                  </text>
                                </Show>

                                <Show when={node.error}>
                                  <text fg={theme.error} wrapMode="word">
                                    {node.error}
                                  </text>
                                </Show>

                                <Show when={node.sessionID}>
                                  <text
                                    fg={theme.primary}
                                    wrapMode="word"
                                    onMouseDown={() => {
                                      route.navigate({
                                        type: "session",
                                        sessionID: node.sessionID!,
                                      })
                                      dialog.clear()
                                    }}
                                  >
                                    Open session {node.sessionID}
                                  </text>
                                </Show>
                              </box>
                            )
                          }}
                        </For>
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