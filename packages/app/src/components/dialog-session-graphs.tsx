import { Button } from "@openagent/ui/button"
import { Dialog } from "@openagent/ui/dialog"
import { showToast } from "@openagent/ui/toast"
import { useDialog } from "@openagent/ui/context/dialog"
import { base64Encode } from "@openagent/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useAppRoute } from "@/context/app-route"
import { useSDK } from "@/context/sdk"
import { pathKey } from "@/utils/path-key"

export function DialogSessionGraphs(props: { sessionID: string; directory?: string }) {
  const dialog = useDialog()
  const navigate = useNavigate()
  const route = useAppRoute()
  const sdk = useSDK()
  const [graphID, setGraphID] = createSignal<string>()
  const [nodeID, setNodeID] = createSignal<string>()
  const directory = createMemo(() => props.directory ?? sdk.directory)

  const query = useQuery(() => ({
    queryKey: [props.directory ?? sdk.directory, props.sessionID, "session", "graphs"],
    queryFn: () =>
      sdk.client.session
        .graphs({
          sessionID: props.sessionID,
        })
        .then((result) => result.data),
  }))

  const graphs = createMemo(() => query.data?.graphs ?? [])
  const selectedGraph = createMemo(
    () => graphs().find((item) => item.graphID === graphID()) ?? graphs()[0],
  )
  const selectedNode = createMemo(
    () => selectedGraph()?.nodes.find((item) => item.nodeID === nodeID()) ?? selectedGraph()?.nodes[0],
  )

  createEffect(() => {
    const focus = query.data?.focusGraphID
    const graph = graphs().find((item) => item.graphID === focus) ?? graphs()[0]
    if (!graph) return
    if (graphID() !== graph.graphID) setGraphID(graph.graphID)
    if (!graph.nodes.find((item) => item.nodeID === nodeID())) setNodeID(graph.nodes[0]?.nodeID)
  })

  const jump = () => {
    const sessionID = selectedNode()?.sessionID
    if (!sessionID) {
      showToast({
        variant: "error",
        title: "No related session for this node",
      })
      return
    }
    if (route.isChat() && pathKey(route.directory()) === pathKey(directory())) {
      navigate(route.href(sessionID))
    } else {
      navigate(`/${base64Encode(directory())}/session/${sessionID}`)
    }
    dialog.close()
  }

  return (
    <Dialog title="Subagent graphs" size="large" fit>
      <div class="w-[960px] max-w-[calc(100vw-4rem)] h-[70vh] min-h-[520px] flex gap-4">
        <div class="w-64 shrink-0 rounded-md bg-background-base p-2 overflow-auto">
          <Show when={graphs().length > 0} fallback={<div class="p-3 text-14-regular text-text-weak">No graphs found.</div>}>
            <For each={graphs()}>
              {(graph) => (
                <button
                  type="button"
                  class="w-full rounded-md px-3 py-2 text-left transition-colors"
                  classList={{
                    "bg-surface-raised-base text-text-strong": selectedGraph()?.graphID === graph.graphID,
                    "hover:bg-surface-raised-base-hover text-text-base": selectedGraph()?.graphID !== graph.graphID,
                  }}
                  onClick={() => {
                    setGraphID(graph.graphID)
                    setNodeID(graph.nodes[0]?.nodeID)
                  }}
                >
                  <div class="truncate text-13-medium">{graph.graphID}</div>
                  <div class="pt-0.5 text-11-regular text-text-weak">
                    {graph.status} · {graph.nodes.length} nodes
                  </div>
                </button>
              )}
            </For>
          </Show>
        </div>

        <div class="min-w-0 flex-1 rounded-md bg-background-base p-2 overflow-auto">
          <Show
            when={selectedGraph()}
            fallback={<div class="p-3 text-14-regular text-text-weak">Select a graph to inspect its nodes.</div>}
          >
            {(graph) => (
              <div class="flex flex-col gap-2">
                <div class="px-2 py-1.5">
                  <div class="text-14-medium text-text-strong">{graph().graphID}</div>
                  <div class="pt-0.5 text-12-regular text-text-weak">
                    {graph().origin} · {graph().status}
                  </div>
                </div>
                <For each={graph().nodes}>
                  {(node) => (
                    <button
                      type="button"
                      class="w-full rounded-md px-3 py-2 text-left transition-colors"
                      classList={{
                        "bg-surface-raised-base text-text-strong": selectedNode()?.nodeID === node.nodeID,
                        "hover:bg-surface-raised-base-hover text-text-base": selectedNode()?.nodeID !== node.nodeID,
                      }}
                      onClick={() => setNodeID(node.nodeID)}
                    >
                      <div class="truncate text-13-medium">{node.description}</div>
                      <div class="pt-0.5 text-11-regular text-text-weak">
                        {node.agent} · {node.status}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>

        <div class="w-80 shrink-0 rounded-md bg-background-base p-4 overflow-auto">
          <Show
            when={selectedNode()}
            fallback={<div class="text-14-regular text-text-weak">Select a node to inspect its details.</div>}
          >
            {(node) => (
              <div class="flex flex-col gap-4">
                <div>
                  <div class="text-11-medium uppercase tracking-wide text-text-weaker">Description</div>
                  <div class="pt-1 text-14-medium text-text-strong">{node().description}</div>
                </div>

                <div class="grid grid-cols-2 gap-3 text-12-regular">
                  <div>
                    <div class="text-text-weaker">Agent</div>
                    <div class="pt-1 text-text-base">{node().agent}</div>
                  </div>
                  <div>
                    <div class="text-text-weaker">Status</div>
                    <div class="pt-1 text-text-base">{node().status}</div>
                  </div>
                  <div>
                    <div class="text-text-weaker">Node ID</div>
                    <div class="pt-1 text-text-base break-all">{node().nodeID}</div>
                  </div>
                  <div>
                    <div class="text-text-weaker">Session</div>
                    <div class="pt-1 text-text-base break-all">{node().sessionID ?? "None"}</div>
                  </div>
                </div>

                <Show when={node().dependencies.length > 0}>
                  <div>
                    <div class="text-11-medium uppercase tracking-wide text-text-weaker">Dependencies</div>
                    <div class="pt-1 text-12-regular text-text-base break-words">{node().dependencies.join(", ")}</div>
                  </div>
                </Show>

                <Show when={node().blockedBy && node().blockedBy!.length > 0}>
                  <div>
                    <div class="text-11-medium uppercase tracking-wide text-text-weaker">Blocked By</div>
                    <div class="pt-1 text-12-regular text-text-base break-words">{node().blockedBy!.join(", ")}</div>
                  </div>
                </Show>

                <Show when={node().title}>
                  <div>
                    <div class="text-11-medium uppercase tracking-wide text-text-weaker">Title</div>
                    <div class="pt-1 text-12-regular text-text-base">{node().title}</div>
                  </div>
                </Show>

                <Show when={node().output}>
                  <div>
                    <div class="text-11-medium uppercase tracking-wide text-text-weaker">Output</div>
                    <pre class="pt-1 whitespace-pre-wrap break-words text-12-regular text-text-base">{node().output}</pre>
                  </div>
                </Show>

                <Show when={node().error}>
                  <div>
                    <div class="text-11-medium uppercase tracking-wide text-text-weaker">Error</div>
                    <pre class="pt-1 whitespace-pre-wrap break-words text-12-regular text-text-base">{node().error}</pre>
                  </div>
                </Show>

                <Show when={node().sessionID}>
                  <Button variant="secondary" onClick={jump}>
                    Open child session
                  </Button>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
