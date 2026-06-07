import { Button } from "@openagent/ui/button"
import { Dialog } from "@openagent/ui/dialog"
import { List } from "@openagent/ui/list"
import { Switch } from "@openagent/ui/switch"
import { showToast } from "@openagent/ui/toast"
import { useDialog } from "@openagent/ui/context/dialog"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

export function DialogPlugins(props: { directory: string }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const client = () => globalSDK.createClient({ directory: props.directory, throwOnError: true }).experimental.plugins
  const loadPlugins = async () => (await client().list()).data?.plugins ?? []

  const query = useQuery(() => ({
    queryKey: [props.directory, "experimental", "plugins"],
    queryFn: loadPlugins,
  }))

  const items = createMemo(() =>
    (query.data ?? []).slice().sort((a, b) => a.packageName.localeCompare(b.packageName) || a.spec.localeCompare(b.spec)),
  )

  const refresh = async () => {
    await globalSync.refresh(props.directory)
    await queryClient.invalidateQueries({ queryKey: [props.directory, "experimental", "plugins"] })
  }

  const toggle = useMutation(() => ({
    mutationFn: async (input: { spec: string; source: string; enabled: boolean }) => {
      if (input.enabled) await client().enable({ spec: input.spec, source: input.source })
      if (!input.enabled) await client().disable({ spec: input.spec, source: input.source })
      await refresh()
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: "Couldn't update plugin",
        description: error instanceof Error ? error.message : String(error),
      })
    },
  }))

  const install = () => {
    void import("./dialog-install-plugin").then((x) => {
      dialog.show(() => <x.DialogInstallPlugin directory={props.directory} onInstalled={refresh} />)
    })
  }

  return (
    <Dialog
      title="Plugins"
      size="large"
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={install}>
          Install plugin
        </Button>
      }
    >
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search plugins", autofocus: true }}
        emptyMessage={query.isLoading ? "Loading plugins..." : "No plugins configured."}
        key={(item) => `${item.source}:${item.spec}`}
        items={items}
        filterKeys={["spec", "packageName", "source", "scope", "kind"]}
      >
        {(item) => (
          <div class="w-full flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-14-medium text-text-strong">{item.packageName}</div>
              <div class="truncate text-12-regular text-text-weak">{item.spec}</div>
              <div class="pt-1 flex flex-wrap gap-x-3 gap-y-1 text-11-regular text-text-weaker">
                <span>{item.scope}</span>
                <span>{item.kind}</span>
                <span>{item.installed ? "installed" : "not installed"}</span>
                <span>{item.targets.length > 0 ? item.targets.join(", ") : "no targets"}</span>
                <span>{item.editable ? "editable" : "read only"}</span>
              </div>
              <div class="truncate text-11-regular text-text-weaker">{item.source}</div>
            </div>
            <div class="shrink-0" onClick={(event) => event.stopPropagation()}>
              <Switch
                checked={item.enabled}
                disabled={!item.editable || toggle.isPending}
                onChange={(value) => {
                  if (!item.editable || toggle.isPending) return
                  toggle.mutate({
                    spec: item.spec,
                    source: item.source,
                    enabled: value,
                  })
                }}
              />
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
