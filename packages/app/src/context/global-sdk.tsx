import type { Event } from "@opencode-ai/ui/contracts"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import { useServer } from "@/context/server"
import { authTokenFromCredentials, createNullRuntimeClient, createSdkForServer } from "@/utils/server"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const server = useServer()
    const emitter = createGlobalEmitter<{ [key: string]: Event }>()
    const current = () => (server.current?.type === "http" ? server.current.http : undefined)
    const client = createSdkForServer({
      server: current() ?? { url: "frontend-only://runtime" },
      throwOnError: true,
    })
    let source: EventSource | undefined
    let sourceURL: string | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const closeSource = () => {
      source?.close()
      source = undefined
      sourceURL = undefined
    }

    const scheduleStart = () => {
      if (retryTimer !== undefined) return
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void start()
      }, 1000)
    }

    const start = () =>
      Promise.resolve().then(() => {
        const info = current()
        if (!info || info.url.startsWith("frontend-only://")) return
        const url = new URL(`${info.url.replace(/\/+$/, "")}/events`)
        if (info.password) {
          url.searchParams.set(
            "auth_token",
            authTokenFromCredentials({ username: info.username || "openagent", password: info.password }),
          )
        }
        const nextURL = url.toString()
        if (source && sourceURL === nextURL) return
        closeSource()
        sourceURL = nextURL
        source = new EventSource(nextURL)
        source.addEventListener("message", (raw) => {
          const data = JSON.parse((raw as MessageEvent).data) as {
            directory?: string
            event?: Event
          }
          if (data.directory && data.event) emitter.emit(data.directory, data.event)
        })
        source.onerror = () => {
          closeSource()
          scheduleStart()
        }
      })

    onCleanup(() => {
      closeSource()
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    })

    return {
      get url() {
        return current()?.url ?? "frontend-only://runtime"
      },
      client,
      event: {
        on: emitter.on.bind(emitter),
        listen: emitter.listen.bind(emitter),
        start,
      },
      createClient(_opts?: {
        directory?: string
        experimental_workspaceID?: string
        throwOnError?: boolean
      }) {
        const info = current()
        if (!info) return createNullRuntimeClient()
        return createSdkForServer({
          server: info,
          directory: _opts?.directory,
          experimental_workspaceID: _opts?.experimental_workspaceID,
          throwOnError: _opts?.throwOnError,
        })
      },
    }
  },
})
