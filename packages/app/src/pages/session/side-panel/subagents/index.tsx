import { base64Encode } from "@opencode-ai/core/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useNavigate } from "@solidjs/router"
import { createQuery } from "@tanstack/solid-query"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useAppRoute } from "@/context/app-route"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { pathKey } from "@/utils/path-key"
import { sessionTitle } from "@/utils/session-title"
import { buildSubagentsPanelModel, type SubagentNodeRow } from "./model"

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

export function SessionSubagentsPanel(props: { sessionID?: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const route = useAppRoute()
  const navigate = useNavigate()
  const language = useLanguage()
  const [store, setStore] = createStore({
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
    const sessionID = () => row.session?.id ?? row.node.sessionID
    return (
      <button
        type="button"
        class="w-full rounded-md px-3 py-2 text-left text-text-base transition-colors hover:bg-surface-raised-base-hover disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
        classList={{
          "cursor-pointer": !!sessionID(),
        }}
        disabled={!sessionID()}
        onClick={() => openSession(sessionID())}
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
    <div id="subagents-panel" class="size-full min-w-0 overflow-auto bg-background-stronger">
      <div class="min-w-0">
        <div class="sticky top-0 z-10 app-inner-border-b bg-background-stronger px-4 py-3">
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
                    {(session) => (
                      <button
                        type="button"
                        class="w-full rounded-md px-3 py-2 text-left text-text-base transition-colors hover:bg-surface-raised-base-hover"
                        onClick={() => openSession(session.id)}
                      >
                        <div class="truncate text-13-medium">{sessionLabel(session)}</div>
                        <div class="mt-1 truncate text-11-regular text-text-weak">{session.id}</div>
                      </button>
                    )}
                  </For>
                </div>
              </section>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
