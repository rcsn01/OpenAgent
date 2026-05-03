import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createEffect, type ParentProps, Show } from "solid-js"
import { useAppRoute } from "@/context/app-route"
import { useLanguage } from "@/context/language"
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
  const language = useLanguage()
  const navigate = useNavigate()

  createEffect(() => {
    const error = route.chatInfo.error
    if (!error) return
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
    navigate("/chat", { replace: true })
  })

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
