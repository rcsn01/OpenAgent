import { base64Encode } from "@openagent/core/util/encode"
import { createSimpleContext } from "@openagent/ui/context"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo } from "solid-js"
import { decode64 } from "@/utils/base64"

export const { use: useAppRoute, provider: AppRouteProvider } = createSimpleContext({
  name: "AppRoute",
  init: () => {
    const params = useParams()
    const location = useLocation()
    const navigate = useNavigate()

    const kind = createMemo(() => (params.dir ? "workspace" : "none"))
    const workspaceDirectory = createMemo(() => (params.dir ? decode64(params.dir) ?? "" : ""))
    const page = createMemo(() => {
      if (kind() !== "workspace") return "home" as const
      if (location.pathname.split("/")[2] === "automations") return "automations" as const
      if (params.id) return "session" as const
      return "new-session" as const
    })

    createEffect(() => {
      if (kind() !== "workspace") return
      if (!params.dir) return
      if (workspaceDirectory()) return
      void navigate("/", { replace: true })
    })

    const directory = createMemo(() => (kind() === "workspace" ? workspaceDirectory() : ""))
    const slug = createMemo(() => {
      const resolved = directory()
      return resolved ? base64Encode(resolved) : ""
    })
    const routeParams = createMemo(() => ({
      dir: slug(),
      id: kind() === "workspace" ? params.id : undefined,
    }))
    const href = (sessionID?: string) => {
      const dir = slug()
      if (!dir) return "/"
      return `/${dir}/session${sessionID ? `/${sessionID}` : ""}`
    }
    const automationHref = (automationID?: string) => {
      const dir = slug()
      if (!dir) return "/"
      return `/${dir}/automations${automationID ? `/${automationID}` : ""}`
    }
    return {
      kind,
      page,
      isChat: createMemo(() => false),
      params: routeParams,
      directory,
      slug,
      sessionID: createMemo(() => routeParams().id),
      rootSessionID: createMemo(() => routeParams().id),
      automationID: createMemo(() => (kind() === "workspace" ? params.automationID : undefined)),
      ready: createMemo(() => kind() !== "workspace" || !!workspaceDirectory()),
      chatInfo: {
        latest: undefined,
        error: undefined,
      },
      href,
      automationHref,
    }
  },
})
