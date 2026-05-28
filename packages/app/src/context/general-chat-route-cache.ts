import { createSignal, onCleanup } from "solid-js"
import type { Session } from "@openagent-ai/sdk/v2/client"

export type CachedGeneralChatInfo = {
  session: Session
  rootSessionID: string
  directory: string
}

let chats: CachedGeneralChatInfo[] = []
const subscribers = new Set<() => void>()

const notify = () => subscribers.forEach((fn) => fn())

export function setCachedGeneralChats(next: CachedGeneralChatInfo[]) {
  chats = next
  notify()
}

export function upsertCachedGeneralChat(chat: CachedGeneralChatInfo) {
  chats = [chat, ...chats.filter((item) => item.rootSessionID !== chat.rootSessionID)]
  notify()
}

export function removeCachedGeneralChat(sessionID: string) {
  chats = chats.filter((item) => item.rootSessionID !== sessionID)
  notify()
}

export function cachedGeneralChat(sessionID: string | undefined) {
  if (!sessionID) return
  return chats.find((chat) => chat.rootSessionID === sessionID || chat.session.id === sessionID)
}

export function useCachedGeneralChat(sessionID: () => string | undefined) {
  const [revision, setRevision] = createSignal(0)
  const update = () => setRevision((value) => value + 1)
  subscribers.add(update)
  onCleanup(() => subscribers.delete(update))
  return () => {
    revision()
    return cachedGeneralChat(sessionID())
  }
}
