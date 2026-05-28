import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { base64Encode } from "@opencode-ai/ui/utils/encode"
import { setSessionHandoff } from "@/pages/session/handoff"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./deep-links"

export function useLayoutDeepLinks(input: {
  isLocalServer: () => unknown
  openProject: (directory: string, navigate?: boolean) => void | Promise<void>
  navigateWithSidebarReset: (href: string) => void
}) {
  const handleDeepLinks = (urls: string[]) => {
    if (!input.isLocalServer()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      void input.openProject(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      void input.openProject(link.directory, false)
      const slug = base64Encode(link.directory)
      if (link.prompt) {
        setSessionHandoff(slug, { prompt: link.prompt })
      }
      const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
      input.navigateWithSidebarReset(href)
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
  })

  return { handleDeepLinks }
}
