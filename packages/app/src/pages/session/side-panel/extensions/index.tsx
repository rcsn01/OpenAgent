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
    if (!item.bundle || pending.install || pending.remove || pending.server) return
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
    if (!item.installed || pending.install || pending.remove || pending.server) return
    setPending("remove", item.id)
    try {
      await client().remove({ id: item.id })
      await refresh()
    } catch (error) {
      fail(error)
    } finally {
      setPending("remove", undefined)
    }
  }

  const toggleServer = async (server: ExtensionPanelItem["servers"][number]) => {
    if (pending.install || pending.remove || pending.server) return
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

  return (
    <div id="extensions-panel" class="size-full min-w-0 flex flex-col overflow-hidden bg-background-base">
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
      </div>

      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search extensions", autofocus: false }}
        emptyMessage={query.isLoading ? "Loading extensions..." : "No installed or bundled extensions."}
        key={(item) => item.id}
        items={model}
        filterKeys={["search"]}
      >
        {(item) => (
          <div class="w-full rounded-lg border border-border-weaker-base bg-background-stronger px-3 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="truncate text-14-medium text-text-strong">{item.name}</div>
                  <Show when={item.installed}>
                    <span class="rounded-full bg-surface-raised-base px-2 py-0.5 text-10-medium uppercase text-text-weak">
                      installed
                    </span>
                  </Show>
                </div>
                <Show when={item.description}>
                  <div class="mt-1 text-12-regular text-text-weak">{item.description}</div>
                </Show>
                <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weaker">
                  <span>{item.id}</span>
                  <span>v{item.version}</span>
                  <Show when={item.config_path}>
                    <span class="truncate">{item.config_path}</span>
                  </Show>
                  <For each={item.tags}>{(tag) => <span>{tag}</span>}</For>
                </div>
              </div>

              <Switch>
                <Match when={item.installed}>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={pending.install !== undefined || pending.remove !== undefined || pending.server !== undefined}
                    onClick={() => void remove(item)}
                  >
                    <Show when={pending.remove === item.id} fallback="Remove">
                      <Spinner class="size-3" />
                    </Show>
                  </Button>
                </Match>
                <Match when={item.bundle}>
                  <Button
                    size="small"
                    disabled={pending.install !== undefined || pending.remove !== undefined || pending.server !== undefined}
                    onClick={() => void install(item)}
                  >
                    <Show when={pending.install === item.id} fallback="Install">
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
            </div>

            <Show when={item.setup}>
              <div class="mt-3 space-y-2">
                <div class="text-11-medium uppercase text-text-weaker">Setup</div>

                <Show when={item.setup?.prerequisites?.length}>
                  <div class="rounded-md bg-surface-raised-base px-3 py-2">
                    <div class="text-12-medium text-text-base">Prerequisites</div>
                    <div class="mt-1 flex flex-col gap-1 text-11-regular text-text-weak">
                      <For each={item.setup?.prerequisites ?? []}>{(prerequisite) => <div>{prerequisite}</div>}</For>
                    </div>
                  </div>
                </Show>

                <Show when={item.setup?.environment?.length}>
                  <div class="rounded-md bg-surface-raised-base px-3 py-2">
                    <div class="text-12-medium text-text-base">Environment</div>
                    <div class="mt-1 flex flex-wrap gap-2">
                      <For each={item.setup?.environment ?? []}>
                        {(variable) => (
                          <code class="rounded bg-background-base px-1.5 py-0.5 font-mono text-11-regular text-text-base">
                            {variable}
                          </code>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={item.setup?.steps?.length}>
                  <div class="rounded-md bg-surface-raised-base px-3 py-2">
                    <div class="text-12-medium text-text-base">Steps</div>
                    <div class="mt-1 flex flex-col gap-1 text-11-regular text-text-weak">
                      <For each={item.setup?.steps ?? []}>{(step) => <div>{step}</div>}</For>
                    </div>
                  </div>
                </Show>

                <Show when={item.setup?.links?.length}>
                  <div class="rounded-md bg-surface-raised-base px-3 py-2">
                    <div class="text-12-medium text-text-base">Docs</div>
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-11-regular">
                      <For each={item.setup?.links ?? []}>
                        {(link) => <Link href={link.href}>{link.label}</Link>}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={item.servers.length > 0}>
              <div class="mt-3 space-y-2">
                <div class="text-11-medium uppercase text-text-weaker">Servers</div>
                <For each={item.servers}>
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
                          disabled={!item.installed || pending.install !== undefined || pending.remove !== undefined || pending.server !== undefined}
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
              </div>
            </Show>

            <Show when={item.skills.length > 0}>
              <div class="mt-3">
                <div class="text-11-medium uppercase text-text-weaker">Skills</div>
                <div class="mt-2 flex flex-col gap-2">
                  <For each={item.skills}>
                    {(skill) => (
                      <div class="rounded-md bg-surface-raised-base px-3 py-2">
                        <div class="text-13-medium text-text-base">{skill.name}</div>
                        <div class="mt-1 text-11-regular text-text-weak">{skill.description}</div>
                        <div class="mt-1 truncate text-11-regular text-text-weaker">{skill.location}</div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        )}
      </List>
    </div>
  )
}
