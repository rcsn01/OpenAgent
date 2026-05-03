import { base64Encode } from "@opencode-ai/core/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useNavigate } from "@solidjs/router"
import { createQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useAppRoute } from "@/context/app-route"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { pathKey } from "@/utils/path-key"
import { sessionTitle } from "@/utils/session-title"
import {
  buildSubagentsPanelModel,
  type SubagentNodeRow,
  type SubagentSelection,
} from "./session-subagents-panel-model"

function nodeStatusClass(status: SubagentNodeRow["node"]["status"]) {
  if (status === "running") return "text-icon-warning-base"
  if (status === "completed") return "text-icon-success-base"
  if (status === "failed" || status === "blocked") return "text-text-danger-base"
  if (status === "cancelled") return "text-text-weaker"
  return "text-text-weak"
}

function graphStatusClass(status: "active" | "completed" | "failed" | "cancelled") {
  if (status === "active") return "text-icon-warning-base"
  if (status === "completed") return "text-icon-success-base"
  if (status === "failed") return "text-text-danger-base"
  return "text-text-weaker"
}

function sessionLabel(input: { title?: string; id: string }) {
  return sessionTitle(input.title) ?? input.title ?? input.id
}

function sameSelection(left: SubagentSelection | undefined, right: SubagentSelection | undefined) {
  if (!left || !right) return left === right
  if (left.type !== right.type) return false
  if (left.type === "node" && right.type === "node") return left.graphID === right.graphID && left.nodeID === right.nodeID
  if (left.type === "session" && right.type === "session") return left.sessionID === right.sessionID
  return false
}

function selectionKey(selection: SubagentSelection | undefined) {
  if (!selection) return ""
  if (selection.type === "node") return `node:${selection.graphID}:${selection.nodeID}`
  return `session:${selection.sessionID}`
}

export function SessionSubagentsPanel(props: { sessionID?: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const route = useAppRoute()
  const navigate = useNavigate()
  const language = useLanguage()
  const [store, setStore] = createStore({
    selection: undefined as SubagentSelection | undefined,
    expandedGraphs: {} as Record<string, boolean>,
  })

  const query = createQuery(() => ({
    queryKey: [sdk.directory, props.sessionID, "session", "subagents-panel"],
    enabled: !!props.sessionID,
    refetchInterval: props.sessionID ? 2500 : false,
    queryFn: () =>
      sdk.client.session
        .graphs({
          sessionID: props.sessionID!,
          directory: sdk.directory,
        })
        .then((result) => result.data),
  }))

  const model = createMemo(() =>
    buildSubagentsPanelModel({
      sessionID: props.sessionID ?? "",
      sessions: sync.data.session,
      response: query.data,
    }),
  )

  createEffect(() => {
    const current = store.selection
    const next = model().defaultSelection
    if (sameSelection(current, next)) return
    if (current?.type === "node") {
      const graph = model().graphs.find((item) => item.graph.graphID === current.graphID)
      if (graph?.nodes.some((item) => item.node.nodeID === current.nodeID)) return
    }
    if (current?.type === "session" && model().childSessions.some((item) => item.id === current.sessionID)) return
    setStore("selection", next)
  })

  const selectedNode = createMemo(() => {
    const selection = store.selection
    if (selection?.type !== "node") return
    return model()
      .graphs.find((item) => item.graph.graphID === selection.graphID)
      ?.nodes.find((item) => item.node.nodeID === selection.nodeID)
  })

  const selectedSession = createMemo(() => {
    const node = selectedNode()
    if (node?.session) return node.session
    const selection = store.selection
    if (selection?.type !== "session") return
    return model().childSessions.find((item) => item.id === selection.sessionID)
  })

  const openSession = (sessionID: string | undefined) => {
    if (!sessionID) return
    if (route.isChat() && pathKey(route.directory()) === pathKey(sdk.directory)) {
      navigate(route.href(sessionID))
      return
    }
    navigate(`/${base64Encode(sdk.directory)}/session/${sessionID}`)
  }

  const graphExpanded = (graphID: string) => store.expandedGraphs[graphID] === true
  const toggleGraph = (graphID: string) => setStore("expandedGraphs", graphID, !graphExpanded(graphID))

  const nodeButton = (row: SubagentNodeRow) => {
    const selected = () =>
      store.selection?.type === "node" &&
      store.selection.graphID === row.graphID &&
      store.selection.nodeID === row.node.nodeID
    return (
      <button
        type="button"
        class="w-full rounded-md px-3 py-2 text-left transition-colors"
        classList={{
          "bg-surface-raised-base text-text-strong": selected(),
          "hover:bg-surface-raised-base-hover text-text-base": !selected(),
        }}
        onClick={() => setStore("selection", { type: "node", graphID: row.graphID, nodeID: row.node.nodeID })}
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class={`text-12-medium ${nodeStatusClass(row.node.status)}`}>●</span>
          <span class="min-w-0 flex-1 truncate text-13-medium">{row.node.description}</span>
        </div>
        <div class="mt-1 flex flex-wrap gap-x-2 gap-y-1 pl-4 text-11-regular text-text-weak">
          <span>@{row.node.agent}</span>
          <span>{row.node.status}</span>
          <Show when={row.node.dependencies.length > 0}>
            <span>{row.node.dependencies.length} deps</span>
          </Show>
          <Show when={row.session}>
            {(session) => <span class="truncate">{sessionLabel(session())}</span>}
          </Show>
        </div>
      </button>
    )
  }

  return (
    <div id="subagents-panel" class="size-full min-w-0 flex overflow-hidden bg-background-base">
      <div class="w-[44%] min-w-[240px] max-w-[360px] shrink-0 border-r border-border-weaker-base bg-background-stronger overflow-auto">
        <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-stronger px-4 py-3">
          <div class="flex items-center gap-2 text-14-medium text-text-strong">
            <Icon name="branch" size="small" class="text-icon-base" />
            {language.t("session.subagents.title")}
          </div>
          <div class="mt-2 grid grid-cols-5 gap-2 text-11-regular text-text-weak">
            <div>
              <div class="text-13-medium text-text-base">{model().summary.graphs}</div>
              <div>{language.t("session.subagents.summary.graphs")}</div>
            </div>
            <div>
              <div class="text-13-medium text-text-base">{model().summary.children}</div>
              <div>{language.t("session.subagents.summary.children")}</div>
            </div>
            <div>
              <div class="text-13-medium text-text-base">{model().summary.active}</div>
              <div>{language.t("session.subagents.summary.active")}</div>
            </div>
            <div>
              <div class="text-13-medium text-text-base">{model().summary.running}</div>
              <div>{language.t("session.subagents.summary.running")}</div>
            </div>
            <div>
              <div class="text-13-medium text-text-base">{model().summary.failed}</div>
              <div>{language.t("session.subagents.summary.failed")}</div>
            </div>
          </div>
          <Show when={query.isLoading}>
            <div class="mt-2 flex items-center gap-2 text-12-regular text-text-weak">
              <Spinner class="size-3" />
              {language.t("session.subagents.loading")}
            </div>
          </Show>
          <Show when={query.error}>
            <div class="mt-2 text-12-regular text-text-danger-base">{language.t("session.subagents.error")}</div>
          </Show>
        </div>

        <div class="p-2">
          <Show
            when={model().graphs.length > 0 || model().ungrouped.length > 0}
            fallback={<div class="p-3 text-13-regular text-text-weak">{language.t("session.subagents.empty")}</div>}
          >
            <For each={model().graphs}>
              {(group) => (
                <section class="mb-3">
                  <button
                    type="button"
                    class="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised-base-hover"
                    aria-expanded={graphExpanded(group.graph.graphID)}
                    onClick={() => toggleGraph(group.graph.graphID)}
                  >
                    <div class="flex min-w-0 items-center justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-1.5">
                        <Icon
                          name={graphExpanded(group.graph.graphID) ? "chevron-down" : "chevron-right"}
                          size="small"
                          class="shrink-0 text-icon-weak"
                        />
                        <div class="min-w-0 truncate text-12-medium text-text-strong">{group.graph.graphID}</div>
                      </div>
                      <div class={`shrink-0 text-11-regular ${graphStatusClass(group.graph.status)}`}>
                        {group.graph.status}
                      </div>
                    </div>
                    <div class="mt-0.5 text-11-regular text-text-weak">
                      {group.graph.origin} · {group.nodes.length} {language.t("session.subagents.nodes")}
                    </div>
                  </button>
                  <Show when={graphExpanded(group.graph.graphID)}>
                    <div class="mt-1 flex flex-col gap-1">
                      <For each={group.nodes}>{nodeButton}</For>
                    </div>
                  </Show>
                </section>
              )}
            </For>

            <Show when={model().ungrouped.length > 0}>
              <section>
                <div class="px-2 py-1.5 text-12-medium text-text-strong">
                  {language.t("session.subagents.ungrouped")}
                </div>
                <div class="flex flex-col gap-1">
                  <For each={model().ungrouped}>
                    {(session) => {
                      const selected = () => store.selection?.type === "session" && store.selection.sessionID === session.id
                      return (
                        <button
                          type="button"
                          class="w-full rounded-md px-3 py-2 text-left transition-colors"
                          classList={{
                            "bg-surface-raised-base text-text-strong": selected(),
                            "hover:bg-surface-raised-base-hover text-text-base": !selected(),
                          }}
                          onClick={() => setStore("selection", { type: "session", sessionID: session.id })}
                        >
                          <div class="truncate text-13-medium">{sessionLabel(session)}</div>
                          <div class="mt-1 truncate text-11-regular text-text-weak">{session.id}</div>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </section>
            </Show>
          </Show>
        </div>
      </div>

      <div class="min-w-0 flex-1 overflow-auto p-5">
        <Switch
          fallback={
            <div class="h-full flex items-center justify-center text-center text-14-regular text-text-weak">
              {language.t("session.subagents.inspect.empty")}
            </div>
          }
        >
          <Match when={selectedNode()}>
            {(row) => (
              <div class="flex max-w-2xl flex-col gap-5">
                <div>
                  <div class="text-11-medium uppercase text-text-weaker">{language.t("session.subagents.inspect.node")}</div>
                  <div class="mt-1 text-18-medium text-text-strong">{row().node.description}</div>
                  <div class="mt-1 flex flex-wrap gap-2 text-12-regular text-text-weak">
                    <span>{row().node.nodeID}</span>
                    <span>@{row().node.agent}</span>
                    <span class={nodeStatusClass(row().node.status)}>{row().node.status}</span>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3 text-12-regular">
                  <div class="rounded-md bg-surface-panel p-3">
                    <div class="text-text-weaker">{language.t("session.subagents.inspect.dependencies")}</div>
                    <div class="mt-1 break-words text-text-base">
                      {row().node.dependencies.length > 0 ? row().node.dependencies.join(", ") : language.t("common.none")}
                    </div>
                  </div>
                  <div class="rounded-md bg-surface-panel p-3">
                    <div class="text-text-weaker">{language.t("session.subagents.inspect.blockedBy")}</div>
                    <div class="mt-1 break-words text-text-base">
                      {(row().node.blockedBy?.length ?? 0) > 0 ? row().node.blockedBy?.join(", ") : language.t("common.none")}
                    </div>
                  </div>
                </div>

                <Show when={row().session}>
                  {(session) => (
                    <div class="rounded-md bg-surface-panel p-3">
                      <div class="text-11-medium uppercase text-text-weaker">{language.t("session.subagents.inspect.session")}</div>
                      <div class="mt-1 text-13-medium text-text-strong">{sessionLabel(session())}</div>
                      <div class="mt-1 break-all text-12-regular text-text-weak">{session().id}</div>
                      <Button class="mt-3" variant="secondary" onClick={() => openSession(session().id)}>
                        {language.t("session.subagents.openSession")}
                      </Button>
                    </div>
                  )}
                </Show>

                <Show when={row().node.title}>
                  <div>
                    <div class="text-11-medium uppercase text-text-weaker">{language.t("session.subagents.inspect.title")}</div>
                    <div class="mt-1 text-13-regular text-text-base">{row().node.title}</div>
                  </div>
                </Show>

                <Show when={row().node.output}>
                  <div>
                    <div class="text-11-medium uppercase text-text-weaker">{language.t("session.subagents.inspect.output")}</div>
                    <pre class="mt-1 whitespace-pre-wrap break-words text-12-regular text-text-base">{row().node.output}</pre>
                  </div>
                </Show>

                <Show when={row().node.error}>
                  <div>
                    <div class="text-11-medium uppercase text-text-weaker">{language.t("session.subagents.inspect.error")}</div>
                    <pre class="mt-1 whitespace-pre-wrap break-words text-12-regular text-text-danger-base">
                      {row().node.error}
                    </pre>
                  </div>
                </Show>
              </div>
            )}
          </Match>

          <Match when={selectedSession()}>
            {(session) => (
              <div class="flex max-w-2xl flex-col gap-4">
                <div>
                  <div class="text-11-medium uppercase text-text-weaker">{language.t("session.subagents.inspect.session")}</div>
                  <div class="mt-1 text-18-medium text-text-strong">{sessionLabel(session())}</div>
                  <div class="mt-1 break-all text-12-regular text-text-weak">{session().id}</div>
                </div>
                <Button variant="secondary" onClick={() => openSession(session().id)}>
                  {language.t("session.subagents.openSession")}
                </Button>
              </div>
            )}
          </Match>
        </Switch>

        <div class="hidden" data-selection={selectionKey(store.selection)} />
      </div>
    </div>
  )
}
