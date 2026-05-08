import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSync } from "@/context/global-sync"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { OFFICIAL_EXTENSIONS } from "@/extensions/registry"
import { formatServerError } from "@/utils/server-errors"
import { installExtension } from "./install"
import { buildExtensionsPanelModel, type ExtensionPanelItem } from "./model"

type ExtensionBrowseKind = "skills" | "mcp" | "extensions"
type ExtensionFilter = "all" | "installed" | "available"
type ExtensionListEntry = {
  id: string
  kind: ExtensionBrowseKind
  extension: ExtensionPanelItem
  title: string
  description?: string
  meta: string[]
  installed: boolean
  search: string
}

const browseLabels: Record<ExtensionBrowseKind, string> = {
  skills: "Skills",
  mcp: "MCP",
  extensions: "Extensions",
}

const filterLabels: Record<ExtensionFilter, string> = {
  all: "All",
  installed: "Installed",
  available: "Not Installed",
}

function statusTone(status: ExtensionPanelItem["servers"][number]["status"]["status"]) {
  if (status === "connected") return "text-icon-success-base"
  if (status === "failed") return "text-text-danger-base"
  if (status === "needs_auth" || status === "needs_client_registration") return "text-icon-warning-base"
  return "text-text-weak"
}

function statusLabel(status: ExtensionPanelItem["servers"][number]["status"]["status"]) {
  if (status === "needs_auth") return "Needs auth"
  if (status === "needs_client_registration") return "Needs auth setup"
  return status.replaceAll("_", " ")
}

function actionLabel(action: ExtensionPanelItem["servers"][number]["action"]) {
  if (action === "authenticate") return "Authenticate"
  if (action === "disconnect") return "Disconnect"
  return "Connect"
}

function statusError(status: ExtensionPanelItem["servers"][number]["status"]) {
  return "error" in status ? status.error : undefined
}

function hasSetupDetails(item: ExtensionPanelItem) {
  return (
    !!item.setup?.prerequisites?.length ||
    !!item.setup?.environment?.length ||
    !!item.setup?.steps?.length ||
    !!item.setup?.links?.length
  )
}

function itemStatus(item: ExtensionPanelItem) {
  if (!item.installed) return "Not installed"
  if (item.active) return "Installed and connected"
  if (item.servers.some((server) => server.status.status === "failed")) return "Installed with errors"
  if (item.servers.some((server) => server.status.status === "needs_auth" || server.status.status === "needs_client_registration")) {
    return "Installed, auth needed"
  }
  return "Installed"
}

function filterItem<T extends { installed: boolean }>(item: T, filter: ExtensionFilter) {
  if (filter === "installed") return item.installed
  if (filter === "available") return !item.installed
  return true
}

export function SessionExtensionsPanel() {
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const client = () => sdk.client.experimental.extensions
  const [pending, setPending] = createStore({
    install: undefined as string | undefined,
    remove: undefined as string | undefined,
    server: undefined as string | undefined,
  })
  const [view, setView] = createStore({
    kind: "skills" as ExtensionBrowseKind,
    filter: "all" as ExtensionFilter,
    selected: undefined as string | undefined,
    selectedKind: undefined as ExtensionBrowseKind | undefined,
  })

  const query = createQuery(() => ({
    queryKey: [sdk.directory, "experimental", "extensions"],
    queryFn: () => client().list().then((result) => result.data?.extensions ?? []),
  }))

  const model = createMemo(() =>
    buildExtensionsPanelModel({
      registry: OFFICIAL_EXTENSIONS,
      installed: query.data ?? [],
      live: sync.data.mcp ?? {},
    }),
  )
  const entries = createMemo<ExtensionListEntry[]>(() => {
    if (view.kind === "extensions") {
      return model().map((item) => ({
        id: item.id,
        kind: "extensions",
        extension: item,
        title: item.name,
        description: item.description,
        meta: [itemStatus(item), `${item.servers.length} MCP`, `${item.skills.length} skills`, ...item.tags.slice(0, 3)],
        installed: item.installed,
        search: item.search,
      }))
    }

    if (view.kind === "mcp") {
      return model().flatMap((item) =>
        item.servers.map((server) => ({
          id: `${item.id}:mcp:${server.key}`,
          kind: "mcp" as const,
          extension: item,
          title: server.key,
          description: `${statusLabel(server.status.status)} in ${item.name}`,
          meta: [item.name, itemStatus(item), `${server.tools.length} tools`],
          installed: item.installed,
          search: [item.search, server.key, statusLabel(server.status.status), ...server.tools.map((tool) => tool.name)]
            .filter(Boolean)
            .join(" "),
        })),
      )
    }

    return model().flatMap((item) =>
      item.skills.map((skill) => ({
        id: `${item.id}:skill:${skill.location ?? skill.name}`,
        kind: "skills" as const,
        extension: item,
        title: skill.name,
        description: skill.description,
        meta: [item.name, itemStatus(item)],
        installed: item.installed,
        search: [item.search, skill.name, skill.description, skill.location].filter(Boolean).join(" "),
      })),
    )
  })
  const filteredEntries = createMemo(() => {
    return entries().filter((entry) => filterItem(entry, view.filter))
  })
  const selected = createMemo(() => model().find((item) => item.id === view.selected))
  const busy = createMemo(() => pending.install !== undefined || pending.remove !== undefined || pending.server !== undefined)

  const refresh = async () => {
    await globalSync.refresh(sdk.directory)
    await queryClient.invalidateQueries({ queryKey: [sdk.directory, "experimental", "extensions"] })
  }

  const fail = (error: unknown) => {
    console.error("[extensions] update failed", error)
    showToast({
      variant: "error",
      title: "Couldn't update extensions",
      description: formatServerError(error, undefined, "Request failed"),
    })
  }

  const install = async (item: ExtensionPanelItem) => {
    if (!item.bundle || busy()) return
    setPending("install", item.id)
    try {
      await installExtension({
        bundle: item.bundle,
        client: {
          experimental: {
            install: (bundle) => client().install(bundle),
          },
          mcp: {
            connect: (input) => sdk.client.mcp.connect(input),
            auth: {
              authenticate: (input) => sdk.client.mcp.auth.authenticate(input),
            },
          },
        },
        refresh,
      })
    } catch (error) {
      await refresh()
      fail(error)
    } finally {
      setPending("install", undefined)
    }
  }

  const remove = async (item: ExtensionPanelItem) => {
    if (!item.installed || busy()) return
    setPending("remove", item.id)
    try {
      await client().remove({ id: item.id })
      setView({ selected: undefined, selectedKind: undefined })
      await refresh()
    } catch (error) {
      fail(error)
    } finally {
      setPending("remove", undefined)
    }
  }

  const toggleServer = async (server: ExtensionPanelItem["servers"][number]) => {
    if (busy()) return
    setPending("server", server.key)
    try {
      if (server.action === "disconnect") await sdk.client.mcp.disconnect({ name: server.key })
      if (server.action === "connect") await sdk.client.mcp.connect({ name: server.key })
      if (server.action === "authenticate") await sdk.client.mcp.auth.authenticate({ name: server.key })
      await refresh()
    } catch (error) {
      fail(error)
    } finally {
      setPending("server", undefined)
    }
  }

  const ExtensionAction = (props: { item: ExtensionPanelItem }) => (
    <Switch>
      <Match when={props.item.installed}>
        <Button size="small" variant="secondary" disabled={busy()} onClick={() => void remove(props.item)}>
          <Show when={pending.remove === props.item.id} fallback="Remove">
            <Spinner class="size-3" />
          </Show>
        </Button>
      </Match>
      <Match when={props.item.bundle}>
        <Button size="small" disabled={busy()} onClick={() => void install(props.item)}>
          <Show when={pending.install === props.item.id} fallback="Install">
            <Spinner class="size-3" />
          </Show>
        </Button>
      </Match>
      <Match when={true}>
        <Button size="small" variant="secondary" disabled>
          Unavailable
        </Button>
      </Match>
    </Switch>
  )

  const ExtensionDetails = (props: { item: ExtensionPanelItem; sourceKind: ExtensionBrowseKind | undefined }) => (
    <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar">
      <div class="border-b border-border-weaker-base bg-background-stronger px-4 py-3">
        <Button size="small" variant="ghost" class="mb-3 -ml-2" onClick={() => setView({ selected: undefined, selectedKind: undefined })}>
          Back
        </Button>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-16-medium text-text-strong">{props.item.name}</div>
            <Show when={props.item.description}>
              <div class="mt-1 text-12-regular text-text-weak">{props.item.description}</div>
            </Show>
            <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weaker">
              <span>{props.item.id}</span>
              <span>v{props.item.version}</span>
              <span>{itemStatus(props.item)}</span>
              <For each={props.item.tags}>{(tag) => <span>{tag}</span>}</For>
            </div>
          </div>
          <Show when={props.sourceKind === "extensions"}>
            <ExtensionAction item={props.item} />
          </Show>
        </div>
      </div>

      <div class="space-y-4 p-4">
        <Show when={hasSetupDetails(props.item)}>
          <section class="space-y-2">
            <div class="text-11-medium uppercase text-text-weaker">Setup</div>

            <Show when={props.item.setup?.environment?.length}>
              <div class="rounded-md bg-surface-raised-base px-3 py-2">
                <div class="text-12-medium text-text-base">API keys / environment required</div>
                <div class="mt-1 flex flex-wrap gap-2">
                  <For each={props.item.setup?.environment ?? []}>
                    {(variable) => (
                      <code class="rounded bg-background-base px-1.5 py-0.5 font-mono text-11-regular text-text-base">
                        {variable}
                      </code>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={props.item.setup?.prerequisites?.length}>
              <div class="rounded-md bg-surface-raised-base px-3 py-2">
                <div class="text-12-medium text-text-base">Prerequisites</div>
                <div class="mt-1 flex flex-col gap-1 text-11-regular text-text-weak">
                  <For each={props.item.setup?.prerequisites ?? []}>{(prerequisite) => <div>{prerequisite}</div>}</For>
                </div>
              </div>
            </Show>

            <Show when={props.item.setup?.steps?.length}>
              <div class="rounded-md bg-surface-raised-base px-3 py-2">
                <div class="text-12-medium text-text-base">Steps</div>
                <div class="mt-1 flex flex-col gap-1 text-11-regular text-text-weak">
                  <For each={props.item.setup?.steps ?? []}>{(step) => <div>{step}</div>}</For>
                </div>
              </div>
            </Show>

            <Show when={props.item.setup?.links?.length}>
              <div class="rounded-md bg-surface-raised-base px-3 py-2">
                <div class="text-12-medium text-text-base">Docs</div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-11-regular">
                  <For each={props.item.setup?.links ?? []}>{(link) => <Link href={link.href}>{link.label}</Link>}</For>
                </div>
              </div>
            </Show>
          </section>
        </Show>

        <section class="space-y-2">
          <div class="text-11-medium uppercase text-text-weaker">Servers</div>
          <Show
            when={props.item.servers.length > 0}
            fallback={<div class="rounded-md bg-surface-raised-base px-3 py-2 text-12-regular text-text-weak">No MCP servers.</div>}
          >
            <For each={props.item.servers}>
              {(server) => (
                <div class="rounded-md bg-surface-raised-base px-3 py-2">
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class={`text-12-medium ${statusTone(server.status.status)}`}>●</span>
                        <span class="truncate text-13-medium text-text-base">{server.key}</span>
                        <span class="text-11-regular text-text-weak">{statusLabel(server.status.status)}</span>
                      </div>
                      <Show when={statusError(server.status)}>
                        {(error) => <div class="mt-1 text-11-regular text-text-danger-base">{error()}</div>}
                      </Show>
                      <Show when={server.tools.length > 0}>
                        <div class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-11-regular text-text-weaker">
                          <For each={server.tools}>{(tool) => <span>{tool.name}</span>}</For>
                        </div>
                      </Show>
                    </div>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={!props.item.installed || busy()}
                      onClick={() => void toggleServer(server)}
                    >
                      <Show when={pending.server === server.key} fallback={actionLabel(server.action)}>
                        <Spinner class="size-3" />
                      </Show>
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </section>

        <section class="space-y-2">
          <div class="text-11-medium uppercase text-text-weaker">Skills</div>
          <Show
            when={props.item.skills.length > 0}
            fallback={<div class="rounded-md bg-surface-raised-base px-3 py-2 text-12-regular text-text-weak">No managed skills.</div>}
          >
            <For each={props.item.skills}>
              {(skill) => (
                <div class="rounded-md bg-surface-raised-base px-3 py-2">
                  <div class="text-13-medium text-text-base">{skill.name}</div>
                  <Show when={skill.description}>
                    {(description) => <div class="mt-1 text-11-regular text-text-weak">{description()}</div>}
                  </Show>
                  <Show when={skill.location}>
                    {(location) => <div class="mt-1 truncate text-11-regular text-text-weaker">{location()}</div>}
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </section>

        <Show when={props.item.config_path}>
          {(path) => (
            <section class="space-y-2">
              <div class="text-11-medium uppercase text-text-weaker">Installed Config</div>
              <div class="truncate rounded-md bg-surface-raised-base px-3 py-2 text-11-regular text-text-weak">
                {path()}
              </div>
            </section>
          )}
        </Show>
      </div>
    </div>
  )

  const SegmentGroup = <T extends string>(props: {
    entries: Array<[T, string]>
    value: T
    onChange: (value: T) => void
  }) => (
    <div class="grid gap-2" style={{ "grid-template-columns": `repeat(${props.entries.length}, minmax(0, 1fr))` }}>
      <For each={props.entries}>
        {([value, label]) => <SegmentButton active={props.value === value} onClick={() => props.onChange(value)}>{label}</SegmentButton>}
      </For>
    </div>
  )

  const SegmentButton = (props: { active: boolean; onClick: () => void; children: string }) => (
    <button
      type="button"
      class="min-h-9 rounded-lg px-2 py-2 text-12-medium transition-colors"
      classList={{
        "bg-surface-base-active text-text-strong": props.active,
        "bg-surface-raised-base text-text-weak hover:bg-surface-base-hover hover:text-text-strong": !props.active,
      }}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )

  return (
    <div id="extensions-panel" class="size-full min-w-0 flex flex-col overflow-hidden bg-background-base">
      <Show
        when={selected()}
        keyed
        fallback={
          <>
            <div class="border-b border-border-weaker-base bg-background-stronger px-4 py-3">
              <div class="flex items-center gap-2 text-14-medium text-text-strong">
                <Icon name="mcp" size="small" class="text-icon-base" />
                Extensions
              </div>
              <div class="mt-1 text-12-regular text-text-weak">
                Project-scoped bundles of MCP servers and managed skills.
              </div>
              <Show when={query.isLoading}>
                <div class="mt-2 flex items-center gap-2 text-12-regular text-text-weak">
                  <Spinner class="size-3" />
                  Loading extensions...
                </div>
              </Show>
              <Show when={query.error}>
                <div class="mt-2 text-12-regular text-text-danger-base">
                  {query.error instanceof Error ? query.error.message : String(query.error)}
                </div>
              </Show>

              <div class="mt-3">
                <SegmentGroup
                  entries={Object.entries(browseLabels) as Array<[ExtensionBrowseKind, string]>}
                  value={view.kind}
                  onChange={(kind) => setView("kind", kind)}
                />
              </div>

              <div class="mt-2">
                <SegmentGroup
                  entries={Object.entries(filterLabels) as Array<[ExtensionFilter, string]>}
                  value={view.filter}
                  onChange={(filter) => setView("filter", filter)}
                />
              </div>
            </div>

            <List
              class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 [&_[data-slot=list-items]]:gap-3 [&_[data-slot=list-item]]:p-0 [&_[data-slot=list-item][data-active=true]]:bg-transparent"
              search={{ placeholder: "Search extensions", autofocus: false }}
              emptyMessage={query.isLoading ? "Loading extensions..." : `No ${browseLabels[view.kind].toLowerCase()} match this filter.`}
              key={(entry) => entry.id}
              items={filteredEntries}
              filterKeys={["search"]}
            >
              {(entry) => (
                <div
                  role="button"
                  tabIndex={0}
                  class="w-full rounded-lg border px-3 py-3 text-left transition-colors hover:bg-surface-base-hover focus:outline-none focus-visible:border-border-focus"
                  classList={{
                    "border-border-weaker-base bg-background-stronger": entry.kind === "extensions",
                    "border-border-weaker-base bg-background-base": entry.kind !== "extensions",
                  }}
                  onClick={() => setView({ selected: entry.extension.id, selectedKind: entry.kind })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    setView({ selected: entry.extension.id, selectedKind: entry.kind })
                  }}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-2">
                        <div
                          class="truncate text-14-medium"
                          classList={{
                            "text-text-strong": entry.kind === "extensions",
                            "text-text-weak": entry.kind !== "extensions",
                          }}
                        >
                          {entry.title}
                        </div>
                        <span
                          class="rounded-full px-2 py-0.5 text-10-medium uppercase"
                          classList={{
                            "bg-surface-raised-base text-text-weak": entry.kind === "extensions",
                            "bg-surface-raised-base text-text-weaker": entry.kind !== "extensions",
                          }}
                        >
                          {entry.installed ? "installed" : "not installed"}
                        </span>
                      </div>
                      <Show when={entry.description}>
                        <div class="mt-1 line-clamp-2 text-12-regular text-text-weak">{entry.description}</div>
                      </Show>
                      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weaker">
                        <For each={entry.meta}>{(meta) => <span>{meta}</span>}</For>
                      </div>
                    </div>

                    <Show
                      when={entry.kind === "extensions"}
                      fallback={
                        <div class="shrink-0 max-w-28 text-right text-11-regular text-text-weaker">
                          Part of {entry.extension.name}
                        </div>
                      }
                    >
                      <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <ExtensionAction item={entry.extension} />
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </List>
          </>
        }
      >
        {(item) => <ExtensionDetails item={item} sourceKind={view.selectedKind} />}
      </Show>
    </div>
  )
}
