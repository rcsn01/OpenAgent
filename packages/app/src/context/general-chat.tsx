import { createSimpleContext } from "@openagent/ui/context"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createResource, onCleanup } from "solid-js"
import { useAppRoute } from "@/context/app-route"
import { useGlobalSDK } from "@/context/global-sdk"
import { useServer } from "@/context/server"
import { pathKey } from "@/utils/path-key"
import { removeCachedGeneralChat, setCachedGeneralChats, upsertCachedGeneralChat } from "./general-chat-route-cache"

export type GeneralChatInfo = {
  session: Session
  rootSessionID: string
  directory: string
}

const updatedAt = (chat: GeneralChatInfo) => chat.session.time.updated ?? chat.session.time.created
const sortChats = (items: GeneralChatInfo[]) => [...items].sort((a, b) => updatedAt(b) - updatedAt(a))

const mergeChat = (items: GeneralChatInfo[], chat: GeneralChatInfo) =>
  sortChats([chat, ...items.filter((item) => item.rootSessionID !== chat.rootSessionID)])

export const { use: useGeneralChats, provider: GeneralChatProvider } = createSimpleContext({
  name: "GeneralChats",
  init: () => {
    const route = useAppRoute()
    const globalSDK = useGlobalSDK()
    const server = useServer()

    let timer: number | undefined

    const [resource, { mutate, refetch }] = createResource(
      () => server.key || false,
      () =>
        globalSDK.client.experimental.chat
          .list()
          .then((result) => sortChats(result.data ?? []))
          .catch(() => [] as GeneralChatInfo[]),
    )

    const list = createMemo(() => resource.latest ?? resource() ?? [])
    const refresh = () => Promise.resolve(refetch()).then(() => undefined)
    const scheduleRefresh = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        void refresh()
      }, 150)
    }

    createEffect(() => {
      const chats = resource.latest ?? resource()
      if (!chats) return
      setCachedGeneralChats(chats)
    })

    const unsub = globalSDK.event.listen((event) => {
      if (event.name === "global") return
      if (
        event.details.type !== "session.created" &&
        event.details.type !== "session.updated" &&
        event.details.type !== "session.deleted"
      ) {
        return
      }

      if (route.isChat() && pathKey(route.directory()) === pathKey(event.name)) {
        scheduleRefresh()
        return
      }

      const session = event.details.properties.info
      if (list().some((item) => item.rootSessionID === session.id || pathKey(item.directory) === pathKey(event.name))) {
        scheduleRefresh()
      }
    })

    onCleanup(() => {
      unsub()
      if (timer !== undefined) clearTimeout(timer)
    })

    return {
      list,
      loading: createMemo(() => resource.loading),
      refresh,
      create: () =>
        globalSDK.client.experimental.chat.create().then((result) => {
          const data = result.data
          if (data) {
            mutate((items) => mergeChat(items ?? [], data))
            upsertCachedGeneralChat(data)
          }
          return data
        }),
      upsert(chat: GeneralChatInfo) {
        mutate((items) => mergeChat(items ?? [], chat))
        upsertCachedGeneralChat(chat)
      },
      remove(sessionID: string) {
        mutate((items) => (items ?? []).filter((item) => item.rootSessionID !== sessionID))
        removeCachedGeneralChat(sessionID)
      },
    }
  },
})
