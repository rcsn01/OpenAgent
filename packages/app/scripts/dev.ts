import { spawn } from "node:child_process"
import { attachOrStartServer } from "@openagent/server/launcher"

const endpoint = await attachOrStartServer().catch((error) => {
  console.error("Failed to start OpenAgent runtime service.")
  console.error(error)
  process.exit(1)
})

const child = spawn("bun", ["run", "start"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_OPENAGENT_RUNTIME_URL: endpoint.url,
    VITE_OPENAGENT_AUTH_TOKEN: endpoint.authToken,
  },
})

child.on("error", (error) => {
  console.error(error)
  process.exit(1)
})

const stop = () => {
  child.kill()
  process.exit(0)
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

child.on("exit", (code) => {
  process.exit(code ?? 0)
})
