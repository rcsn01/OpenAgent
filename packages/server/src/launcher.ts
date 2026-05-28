import { spawn, type ChildProcess } from "node:child_process"
import { access } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { authTokenFromCredentials } from "./shared-client"
import { readServerMetadata, type ServerMetadata } from "./auth"
import { openAgentHome } from "./home"

export type RuntimeEndpoint = {
  url: string
  token: string
  authToken: string
  process?: ChildProcess
}

async function health(metadata: ServerMetadata) {
  try {
    const response = await fetch(`${metadata.url}/health`, { signal: AbortSignal.timeout(500) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForMetadata(home: string, startedAt: number) {
  for (let i = 0; i < 100; i++) {
    const metadata = await readServerMetadata(home)
    if (metadata && metadata.updated >= startedAt && (await health(metadata))) return metadata
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("OpenAgent server did not become healthy")
}

function serverEntry() {
  return join(dirname(fileURLToPath(import.meta.url)), "index.ts")
}

async function sidecarEntry() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [resourcesPath ? join(resourcesPath, "openagent-server", "openagent-server") : ""].filter(Boolean)
  for (const candidate of candidates) {
    if (await canAccess(candidate)) return candidate
  }
}

async function canAccess(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function attachOrStartServer(input: { home?: string; command?: string } = {}): Promise<RuntimeEndpoint> {
  const home = input.home ?? openAgentHome()
  const existing = await readServerMetadata(home)
  if (existing && (await health(existing))) {
    return {
      url: existing.url,
      token: existing.token,
      authToken: authTokenFromCredentials({ username: "openagent", password: existing.token }),
    }
  }

  const sidecar = await sidecarEntry()
  const entry = serverEntry()
  const command = input.command ?? sidecar ?? "bun"
  const args =
    sidecar && !input.command
      ? []
      : command === "bun" && (await canAccess(entry))
        ? [entry]
        : ["--cwd", process.cwd(), "run", "@openagent/server"]
  const startedAt = Date.now()
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENAGENT_HOME: home,
    },
  })
  child.unref()
  const metadata = await waitForMetadata(home, startedAt)
  return {
    url: metadata.url,
    token: metadata.token,
    authToken: authTokenFromCredentials({ username: "openagent", password: metadata.token }),
    process: child,
  }
}
