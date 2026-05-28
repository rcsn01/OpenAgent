import { DataProvider } from "@openagent-ai/ui/context"
import { useNavigate } from "@solidjs/router"
import { type ParentProps, Show } from "solid-js"
import { useAppRoute } from "@/context/app-route"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"

function SessionDataProvider(props: ParentProps) {
  const sync = useSync()
  const route = useAppRoute()
  const navigate = useNavigate()

  return (
    <DataProvider
      data={sync.data}
      directory={route.directory()}
      onNavigateToSession={(sessionID: string) => navigate(route.href(sessionID))}
      onSessionHref={(sessionID: string) => route.href(sessionID)}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function SessionRouteHost(props: ParentProps) {
  const route = useAppRoute()

  return (
    <Show when={route.ready() && route.directory()}>
      <SDKProvider directory={route.directory}>
        <SyncProvider>
          <SessionDataProvider>{props.children}</SessionDataProvider>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
