import { base64Encode } from "@opencode-ai/core/util/encode"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useLocation, useParams } from "@solidjs/router"
import { createMemo, createResource } from "solid-js"
import { useGlobalSDK } from "./global-sdk"
import { decode64 } from "@/utils/base64"
import { GENERAL_CHAT_DRAFT_DIRECTORY } from "@/utils/general-chat"

const matchChat = (pathname: string) => /^\/chat(?:\/([^/?#]+))?\/?$/.exec(pathname)

export const { use: useAppRoute, provider: AppRouteProvider } = createSimpleContext({
  name: "AppRoute",
  init: () => {
    const params = useParams()
    const location = useLocation()
    const globalSDK = useGlobalSDK()

    const kind = createMemo(() => (matchChat(location.pathname) ? "chat" : params.dir ? "workspace" : "none"))
    const chatSessionID = createMemo(() => {
      const id = matchChat(location.pathname)?.[1]
      if (!id) return
      try {
        return decodeURIComponent(id)
      } catch {
        return id
      }
    })
    const workspaceDirectory = createMemo(() => (params.dir ? decode64(params.dir) ?? "" : ""))
    const [chatInfo] = createResource(
      () => (kind() === "chat" && chatSessionID() ? chatSessionID() : false),
      (sessionID) => globalSDK.client.experimental.chat.get({ sessionID }).then((x) => x.data),
    )

    const directory = createMemo(() => {
      if (kind() === "workspace") return workspaceDirectory()
      if (kind() !== "chat") return ""
      if (!chatSessionID()) return GENERAL_CHAT_DRAFT_DIRECTORY
      return chatInfo.latest?.directory ?? ""
    })
    const slug = createMemo(() => {
      if (kind() === "workspace") return params.dir ?? ""
      const resolved = directory()
      if (!resolved) return ""
      return base64Encode(resolved)
    })
    const routeParams = createMemo(() => ({
      dir: slug(),
      id: kind() === "workspace" ? params.id : chatSessionID(),
    }))
    const href = (sessionID?: string) => {
      if (kind() === "chat") return sessionID ? `/chat/${sessionID}` : "/chat"
      const dir = slug()
      if (!dir) return "/"
      return `/${dir}/session${sessionID ? `/${sessionID}` : ""}`
    }

    return {
      kind,
      isChat: createMemo(() => kind() === "chat"),
      params: routeParams,
      directory,
      slug,
      sessionID: createMemo(() => routeParams().id),
      rootSessionID: createMemo(() => chatInfo.latest?.rootSessionID),
      ready: createMemo(() => kind() !== "chat" || !chatSessionID() || !!chatInfo()),
      chatInfo,
      href,
    }
  },
})

