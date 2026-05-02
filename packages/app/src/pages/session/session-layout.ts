import { createMemo } from "solid-js"
import { useAppRoute } from "@/context/app-route"
import { useLayout } from "@/context/layout"

export const useSessionKey = () => {
  const route = useAppRoute()
  const params = {
    get dir() {
      return route.params().dir
    },
    get id() {
      return route.params().id
    },
  }
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  return {
    params,
    sessionKey,
    href: route.href,
    isChat: route.isChat,
    rootSessionID: route.rootSessionID,
  }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const { params, sessionKey, href, isChat, rootSessionID } = useSessionKey()
  return {
    params,
    sessionKey,
    href,
    isChat,
    rootSessionID,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey)),
  }
}
