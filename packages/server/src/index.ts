import { startServer } from "./http"

export { startServer } from "./http"
export { attachOrStartServer } from "./launcher"
export { OpenAgentRuntime } from "./runtime"
export { SessionStore } from "./storage"
export * from "./types"

if (import.meta.main) {
  const server = await startServer()
  console.log(`OpenAgent server listening on ${server.metadata.url}`)
  const stop = () => {
    server.stop()
    process.exit(0)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}
