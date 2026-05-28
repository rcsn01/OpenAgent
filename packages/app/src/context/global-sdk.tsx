import type { Event } from "@opencode-ai/ui/contracts"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createNullRuntimeClient } from "@/utils/server"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const emitter = createGlobalEmitter<{ [key: string]: Event }>()
    const client = createNullRuntimeClient()

    return {
      url: "frontend-only://runtime",
      client,
      event: {
        on: emitter.on.bind(emitter),
        listen: emitter.listen.bind(emitter),
        start: () => Promise.resolve(),
      },
      createClient(_opts?: {
        directory?: string
        experimental_workspaceID?: string
        throwOnError?: boolean
      }) {
        return createNullRuntimeClient()
      },
    }
  },
})
