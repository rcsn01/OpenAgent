import { Dialog } from "@openagent/ui/dialog"
import { List } from "@openagent/ui/list"
import { showToast } from "@openagent/ui/toast"
import { useDialog } from "@openagent/ui/context/dialog"
import { useMutation, useQuery } from "@tanstack/solid-query"
import { createMemo } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function DialogConsoleOrg() {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const sdk = useSDK()
  const sync = useSync()

  const query = useQuery(() => ({
    queryKey: [sync.directory, "console", "orgs"],
    queryFn: () => sdk.client.experimental.console.listOrgs().then((result) => result.data?.orgs ?? []),
  }))

  const items = createMemo(() => (query.data ?? []).slice().sort((a, b) => Number(b.active) - Number(a.active)))

  const mutation = useMutation(() => ({
    mutationFn: (input: { accountID: string; orgID: string }) => sdk.client.experimental.console.switchOrg(input),
    onSuccess: async () => {
      await globalSync.refresh(sync.directory)
      dialog.close()
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: "Couldn't switch org",
        description: error instanceof Error ? error.message : String(error),
      })
    },
  }))

  return (
    <Dialog title="Switch org">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search orgs", autofocus: true }}
        emptyMessage={query.isLoading ? "Loading orgs..." : "No orgs available."}
        key={(item) => `${item.accountID}:${item.orgID}`}
        items={items}
        filterKeys={["orgName", "accountEmail"]}
        onSelect={(item) => {
          if (!item || mutation.isPending) return
          mutation.mutate({
            accountID: item.accountID,
            orgID: item.orgID,
          })
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-14-medium text-text-strong">{item.orgName}</div>
              <div class="truncate text-12-regular text-text-weak">{item.accountEmail}</div>
            </div>
            <div class="shrink-0 text-12-regular text-text-weak">{item.active ? "Active" : ""}</div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
