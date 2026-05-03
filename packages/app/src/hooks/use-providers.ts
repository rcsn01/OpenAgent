import { useAppRoute } from "@/context/app-route"
import { useGlobalSync } from "@/context/global-sync"
import { createMemo } from "solid-js"

export const popularProviders = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const route = useAppRoute()
  const globalSync = useGlobalSync()
  const dir = createMemo(() => route.directory())
  const providers = () => {
    const directory = dir()
    if (directory) return globalSync.child(directory)[0].provider
    return globalSync.data.provider
  }
  const all = () => {
    const list = providers().all
    if (list.length > 0 || !dir() || globalSync.data.provider.all.length === 0) return list
    return globalSync.data.provider.all
  }
  const defaults = () => {
    const value = providers().default
    if (Object.keys(value).length > 0 || !dir() || Object.keys(globalSync.data.provider.default).length === 0)
      return value
    return globalSync.data.provider.default
  }
  const connectedIDs = () => {
    const list = providers().connected
    if (list.length > 0 || !dir() || globalSync.data.provider.connected.length === 0) return list
    return globalSync.data.provider.connected
  }
  return {
    all,
    default: defaults,
    popular: () => all().filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(connectedIDs())
      return all().filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(connectedIDs())
      return all().filter(
        (p) => connected.has(p.id) && (p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input)),
      )
    },
  }
}
