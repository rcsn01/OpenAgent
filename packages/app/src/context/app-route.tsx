import { base64Encode } from "@opencode-ai/core/util/encode"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource } from "solid-js"
import { useGlobalSDK } from "./global-sdk"
import { decode64 } from "@/utils/base64"
import { GENERAL_CHAT_DRAFT_DIRECTORY } from "@/utils/general-chat"
import { useCachedGeneralChat } from "./general-chat-route-cache"

const matchChat = (pathname: string) => /^\/chat(?:\/([^/?#]+))?\/?$/.exec(pathname)
const isChatSessionID = (value: string) => value.startsWith("ses")

export const { use: useAppRoute, provider: AppRouteProvider } = createSimpleContext({
  name: "AppRoute",
  init: () => {
    const params = useParams()
    const location = useLocation()
    const navigate = useNavigate()
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
    const resolvedChatSessionID = createMemo(() => {
      const id = chatSessionID()
      if (!id || !isChatSessionID(id)) return
      return id
    })
    const workspaceDirectory = createMemo(() => (params.dir ? decode64(params.dir) ?? "" : ""))
    const cachedChatInfo = useCachedGeneralChat(resolvedChatSessionID)

    createEffect(() => {
      if (kind() !== "chat") return
      if (!chatSessionID()) return
      if (resolvedChatSessionID()) return
      void navigate("/chat", { replace: true })
    })

    createEffect(() => {
      if (kind() !== "workspace") return
      if (!params.dir) return
      if (workspaceDirectory()) return
      void navigate("/", { replace: true })
    })

    const [chatInfo] = createResource(
      () => {
        if (kind() !== "chat") return false
        const sessionID = resolvedChatSessionID()
        if (!sessionID) return false
        if (cachedChatInfo()) return false
        return sessionID
      },
      (sessionID) => globalSDK.client.experimental.chat.get({ sessionID }).then((x) => x.data),
    )

    const directory = createMemo(() => {
      if (kind() === "workspace") return workspaceDirectory()
      if (kind() !== "chat") return ""
      if (!resolvedChatSessionID()) return GENERAL_CHAT_DRAFT_DIRECTORY
      return cachedChatInfo()?.directory ?? chatInfo.latest?.directory ?? ""
    })
    const slug = createMemo(() => {
      if (kind() === "workspace") return params.dir ?? ""
      const resolved = directory()
      if (!resolved) return ""
      return base64Encode(resolved)
    })
    const routeParams = createMemo(() => ({
      dir: slug(),
      id: kind() === "workspace" ? params.id : resolvedChatSessionID(),
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
      rootSessionID: createMemo(() => cachedChatInfo()?.rootSessionID ?? chatInfo.latest?.rootSessionID),
      ready: createMemo(() => kind() !== "chat" || !resolvedChatSessionID() || !!cachedChatInfo() || !!chatInfo()),
      chatInfo,
      href,
    }
  },
})
