import { Button } from "@openagent-ai/ui/button"
import { Icon, type IconProps } from "@openagent-ai/ui/icon"
import { List } from "@openagent-ai/ui/list"
import { Select } from "@openagent-ai/ui/select"
import { Spinner } from "@openagent-ai/ui/spinner"
import { showToast } from "@openagent-ai/ui/toast"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { OFFICIAL_EXTENSIONS } from "@/extensions/registry"
import { formatServerError } from "@/utils/server-errors"
import { installExtension, missingSetupVariables } from "./install"
import { buildExtensionsPanelModel, type ExtensionPanelItem } from "./model"

type ExtensionBrowseKind = "skills" | "mcp" | "extensions"
type ExtensionFilter = "all" | "installed" | "available"
type ExtensionListEntry = {
  id: string
  kind: ExtensionBrowseKind
  extension: ExtensionPanelItem
  title: string
  description?: string
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
  available: "Available",
}

const filterOptions: ExtensionFilter[] = ["all", "installed", "available"]

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

function statusBadgeClass(item: ExtensionPanelItem) {
  if (!item.installed) return "bg-surface-raised-base text-text-weaker"
  if (item.active) return "bg-surface-raised-base text-icon-success-base"
  if (item.servers.some((server) => server.status.status === "failed")) return "bg-surface-raised-base text-text-danger-base"
  if (item.servers.some((server) => server.status.status === "needs_auth" || server.status.status === "needs_client_registration")) {
    return "bg-surface-raised-base text-icon-warning-base"
  }
  return "bg-surface-raised-base text-text-weak"
}

function filterItem<T extends { installed: boolean }>(item: T, filter: ExtensionFilter) {
  if (filter === "installed") return item.installed
  if (filter === "available") return !item.installed
  return true
}

export function SessionExtensionsPanel() {
  const sdk = useSDK()
  const sync = useSync()
  const platform = usePlatform()
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
  const [setupValues, setSetupValues] = createStore<Record<string, Record<string, string>>>({})

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
        installed: item.installed,
        search: [item.search, skill.name, skill.description, skill.location].filter(Boolean).join(" "),
      })),
    )
  })
  const filteredEntries = createMemo(() => {
    return entries().filter((entry) => filterItem(entry, view.filter))
  })
  const kindCounts = createMemo(() => {
    const items = model()
    return {
      extensions: items.length,
      mcp: items.reduce((sum, item) => sum + item.servers.length, 0),
      skills: items.reduce((sum, item) => sum + item.skills.length, 0),
    }
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

  const setupFor = (item: ExtensionPanelItem) => setupValues[item.id] ?? {}

  const setupMissing = (item: ExtensionPanelItem) => {
    if (!item.bundle) return []
    return missingSetupVariables(item.bundle, setupFor(item))
  }

  const requiresSetupInput = (item: ExtensionPanelItem) => {
    return !!item.bundle && setupMissing(item).length > 0 && !!item.setup?.environment?.length
  }

  const setSetupVariable = (item: ExtensionPanelItem, variable: string, value: string) => {
    setSetupValues(item.id, (current) => ({
      ...(current ?? {}),
      [variable]: value,
    }))
  }

  const importOAuthJson = async (item: ExtensionPanelItem) => {
    if (!platform.openFilePickerDialog || !platform.readTextFile) return
    try {
      const picked = await platform.openFilePickerDialog({
        title: "Choose Google OAuth client JSON",
        extensions: ["json"],
      })
      const file = Array.isArray(picked) ? picked[0] : picked
      if (!file) return
      const raw = await platform.readTextFile(file)
      const parsed = JSON.parse(raw) as {
        installed?: { client_id?: string; client_secret?: string }
        web?: { client_id?: string; client_secret?: string }
      }
      const credentials = parsed.installed ?? parsed.web
      const clientID = credentials?.client_id?.trim()
      const clientSecret = credentials?.client_secret?.trim()
      if (!clientID || !clientSecret) {
        throw new Error("Selected JSON does not contain a Google OAuth client_id and client_secret.")
      }
      setSetupVariable(item, "GOOGLE_OAUTH_CLIENT_ID", clientID)
      setSetupVariable(item, "GOOGLE_OAUTH_CLIENT_SECRET", clientSecret)
    } catch (error) {
      fail(error)
    }
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
        setup: setupFor(item),
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
        <Button
          size="small"
          variant="ghost"
          class="size-7 !p-0 text-icon-success-base"
          aria-label="Installed"
          disabled={busy()}
          onClick={() => void remove(props.item)}
        >
          <Show
            when={pending.remove === props.item.id}
            fallback={
              <span class="group inline-flex size-full items-center justify-center">
                <Icon name="check" size="small" class="group-hover:hidden" />
                <Icon name="close-small" size="small" class="hidden text-text-danger-base group-hover:block" />
              </span>
            }
          >
            <Spinner class="size-3" />
          </Show>
        </Button>
      </Match>
      <Match when={props.item.bundle}>
        <Button
          size="small"
          variant="ghost"
          class="size-7 !p-0"
          aria-label="Install"
          disabled={busy()}
          onClick={() => {
            if (requiresSetupInput(props.item)) {
              setView({ selected: props.item.id, selectedKind: "extensions" })
              return
            }
            void install(props.item)
          }}
        >
          <Show when={pending.install === props.item.id} fallback={<Icon name="plus-small" size="small" />}>
            <Spinner class="size-3" />
          </Show>
        </Button>
      </Match>
      <Match when={true}>
        <Button size="small" variant="ghost" class="size-7 !p-0" aria-label="Unavailable" disabled>
          <Icon name="circle-ban-sign" size="small" />
        </Button>
      </Match>
    </Switch>
  )

  const ExtensionDetails = (props: { item: ExtensionPanelItem; sourceKind: ExtensionBrowseKind | undefined }) => (
    <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar">
      <div class="app-inner-border-b bg-background-stronger px-4 py-3.5">
        <Button
          size="small"
          variant="ghost"
          icon="arrow-left"
          class="mb-3 -ml-2"
          onClick={() => setView({ selected: undefined, selectedKind: undefined })}
        >
          Back
        </Button>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-raised-base text-icon-base">
                <Icon name="mcp" size="small" />
              </div>
              <div class="min-w-0">
                <div class="truncate text-16-medium text-text-strong">{props.item.name}</div>
                <div class="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-11-regular text-text-weaker">
                  <span>{props.item.id}</span>
                  <span>v{props.item.version}</span>
                </div>
              </div>
            </div>
            <Show when={props.item.description}>
              <div class="mt-3 text-12-regular text-text-weak">{props.item.description}</div>
            </Show>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <span class={`rounded-full px-2 py-0.5 text-10-medium uppercase ${statusBadgeClass(props.item)}`}>
                {itemStatus(props.item)}
              </span>
              <For each={props.item.tags}>
                {(tag) => <span class="rounded-full bg-surface-raised-base px-2 py-0.5 text-10-medium uppercase text-text-weaker">{tag}</span>}
              </For>
            </div>
          </div>
          <Show when={props.sourceKind === "extensions" || props.item.bundle || props.item.installed}>
            <ExtensionAction item={props.item} />
          </Show>
        </div>
      </div>

      <div class="space-y-4 p-3">
        <Show when={hasSetupDetails(props.item)}>
          <section class="space-y-2">
            <SectionTitle icon="settings-gear">Setup</SectionTitle>

            <Show when={props.item.setup?.environment?.length}>
              <div class="rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-12-medium text-text-base">OAuth credentials</div>
                    <div class="mt-0.5 text-11-regular text-text-weak">
                      Import a Google OAuth client JSON, or paste the values below. These values are written to this extension's managed MCP config.
                    </div>
                  </div>
                  <Show when={platform.openFilePickerDialog && platform.readTextFile}>
                    <Button size="small" variant="secondary" onClick={() => void importOAuthJson(props.item)}>
                      Import JSON
                    </Button>
                  </Show>
                </div>
                <div class="mt-2 flex flex-col gap-2">
                  <For each={props.item.setup?.environment ?? []}>
                    {(variable) => (
                      <label class="flex flex-col gap-1">
                        <span class="font-mono text-11-regular text-text-weaker">{variable}</span>
                        <input
                          class="h-8 rounded-md border border-border-weaker-base bg-background-base px-2 font-mono text-12-regular text-text-base outline-none focus:border-border-strong-base"
                          type={variable.toLowerCase().includes("secret") ? "password" : "text"}
                          value={setupFor(props.item)[variable] ?? ""}
                          placeholder={variable}
                          onInput={(event) => setSetupVariable(props.item, variable, event.currentTarget.value)}
                        />
                      </label>
                    )}
                  </For>
                </div>
                <div class="mt-2 flex items-center justify-between gap-3">
                  <Show when={setupMissing(props.item).length}>
                    <div class="min-w-0 text-11-regular text-icon-warning-base">
                      Required before install: {setupMissing(props.item).join(", ")}
                    </div>
                  </Show>
                  <Button size="small" variant="primary" disabled={!props.item.bundle || busy()} onClick={() => void install(props.item)}>
                    <Show when={pending.install === props.item.id} fallback={props.item.installed ? "Update setup" : "Install"}>
                      <Spinner class="size-3" />
                    </Show>
                  </Button>
                </div>
              </div>
            </Show>

            <Show when={props.item.setup?.prerequisites?.length}>
              <div class="rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2">
                <div class="text-12-medium text-text-base">Prerequisites</div>
                <div class="mt-1 flex flex-col gap-1 text-11-regular text-text-weak">
                  <For each={props.item.setup?.prerequisites ?? []}>{(prerequisite) => <div>{prerequisite}</div>}</For>
                </div>
              </div>
            </Show>

            <Show when={props.item.setup?.steps?.length}>
              <div class="rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2">
                <div class="text-12-medium text-text-base">Steps</div>
                <div class="mt-1 flex flex-col gap-1 text-11-regular text-text-weak">
                  <For each={props.item.setup?.steps ?? []}>{(step) => <div>{step}</div>}</For>
                </div>
              </div>
            </Show>

            <Show when={props.item.setup?.links?.length}>
              <div class="rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2">
                <div class="text-12-medium text-text-base">Docs</div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-11-regular">
                  <For each={props.item.setup?.links ?? []}>{(link) => <Link href={link.href}>{link.label}</Link>}</For>
                </div>
              </div>
            </Show>
          </section>
        </Show>

        <section class="space-y-2">
          <SectionTitle icon="server">Servers</SectionTitle>
          <Show
            when={props.item.servers.length > 0}
            fallback={<div class="rounded-md bg-background-stronger px-3 py-2 text-12-regular text-text-weak">No MCP servers.</div>}
          >
            <For each={props.item.servers}>
              {(server) => (
                <div class="rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2">
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
          <SectionTitle icon="brain">Skills</SectionTitle>
          <Show
            when={props.item.skills.length > 0}
            fallback={<div class="rounded-md bg-background-stronger px-3 py-2 text-12-regular text-text-weak">No managed skills.</div>}
          >
            <For each={props.item.skills}>
              {(skill) => (
                <div class="rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2">
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
              <SectionTitle icon="code">Installed Config</SectionTitle>
              <div class="truncate rounded-md border border-border-weaker-base bg-background-stronger px-3 py-2 text-11-regular text-text-weak">
                {path()}
              </div>
            </section>
          )}
        </Show>
      </div>
    </div>
  )

  const SegmentGroup = <T extends string>(props: {
    entries: Array<{ value: T; label: string; count?: number }>
    value: T
    onChange: (value: T) => void
    compact?: boolean
  }) => (
    <div class="flex min-w-0 flex-wrap gap-1.5">
      <For each={props.entries}>
        {(entry) => (
          <SegmentButton active={props.value === entry.value} compact={props.compact} onClick={() => props.onChange(entry.value)}>
            <span>{entry.label}</span>
            <Show when={entry.count !== undefined}>
              <span class="text-10-regular opacity-70">{entry.count}</span>
            </Show>
          </SegmentButton>
        )}
      </For>
    </div>
  )

  const SegmentButton = (props: { active: boolean; compact?: boolean; onClick: () => void; children: JSX.Element }) => (
    <button
      type="button"
      class="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md border transition-colors"
      classList={{
        "h-7 px-2.5 text-12-medium": !props.compact,
        "h-6 px-2 text-11-medium": props.compact,
        "border-border-weak-base bg-surface-base-active text-text-strong": props.active,
        "border-border-weaker-base bg-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-strong": !props.active,
      }}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )

  const SectionTitle = (props: { icon: IconProps["name"]; children: string }) => (
    <div class="flex items-center gap-1.5 text-11-medium uppercase text-text-weaker">
      <Icon name={props.icon} size="small" />
      <span>{props.children}</span>
    </div>
  )

  return (
    <div id="extensions-panel" class="size-full min-w-0 flex flex-col overflow-hidden bg-background-stronger">
      <Show
        when={selected()}
        keyed
        fallback={
          <>
            <div class="app-inner-border-b bg-background-stronger px-4 py-3.5">
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

              <div>
                <SegmentGroup
                  entries={(Object.entries(browseLabels) as Array<[ExtensionBrowseKind, string]>).map(([value, label]) => ({
                    value,
                    label,
                    count: kindCounts()[value],
                  }))}
                  value={view.kind}
                  onChange={(kind) => setView("kind", kind)}
                />
              </div>

              <div class="mt-2.5">
                <Select
                  options={filterOptions}
                  current={view.filter}
                  label={(filter) => filterLabels[filter]}
                  onSelect={(filter) => filter && setView("filter", filter)}
                  size="small"
                  variant="secondary"
                  valueClass="text-12-medium"
                />
              </div>
            </div>

            <List
              class="flex-1 min-h-0 !gap-2 !px-3 !pt-3 [&_[data-slot=list-search-wrapper]]:!mb-1 [&_[data-slot=list-search]]:!bg-background-base [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 [&_[data-slot=list-items]]:gap-2 [&_[data-slot=list-item]]:p-0 [&_[data-slot=list-item][data-active=true]]:bg-transparent"
              search={{ placeholder: "Search extensions", autofocus: false }}
              emptyMessage={query.isLoading ? "Loading extensions..." : `No ${browseLabels[view.kind].toLowerCase()} match this filter.`}
              key={(entry) => entry.id}
              items={filteredEntries}
              filterKeys={["search"]}
              onSelect={(entry) => entry && setView({ selected: entry.extension.id, selectedKind: entry.kind })}
            >
              {(entry) => (
                <div
                  class="w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-surface-base-hover"
                  classList={{
                    "border-border-weak-base bg-background-base": entry.kind === "extensions",
                    "border-border-weaker-base bg-background-stronger": entry.kind !== "extensions",
                  }}
                >
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="min-w-0 flex-1">
                      <div
                        class="truncate text-13-medium"
                        classList={{
                          "text-text-strong": entry.kind === "extensions",
                          "text-text-base": entry.kind !== "extensions",
                        }}
                      >
                        {entry.title}
                      </div>
                      <Show when={entry.description}>
                        <div class="mt-0.5 truncate text-12-regular text-text-weak">{entry.description}</div>
                      </Show>
                    </div>
                    <div class="shrink-0" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                      <ExtensionAction item={entry.extension} />
                    </div>
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
