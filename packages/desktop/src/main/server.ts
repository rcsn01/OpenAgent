import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import { DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"

export type WslConfig = { enabled: boolean }

export type ExternalServerMetadata = {
  pid?: number
  url: string
  username?: string | null
  password?: string | null
  dbPath?: string
  startedAt?: string
  version?: string
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function getWslConfig(): WslConfig {
  const value = getStore().get(WSL_ENABLED_KEY)
  return { enabled: typeof value === "boolean" ? value : false }
}

export function setWslConfig(config: WslConfig) {
  getStore().set(WSL_ENABLED_KEY, config.enabled)
}

function stateHome() {
  return process.env.XDG_STATE_HOME || join(app.getPath("home"), ".local", "state")
}

async function readSharedServerMetadata(): Promise<ExternalServerMetadata | undefined> {
  for (const path of [
    join(stateHome(), "opencode", "server", "server.json"),
    join(stateHome(), "opencode", "openagent-server", "server.json"),
  ]) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"))
      if (typeof parsed?.url !== "string") continue
      return parsed
    } catch {}
  }
}

async function startSharedServerFromCli(): Promise<ExternalServerMetadata | undefined> {
  const candidates = [
    process.env.OPENCODE_BIN_PATH,
    process.env.PATH ? "opencode" : undefined,
  ].filter((item): item is string => Boolean(item))

  for (const command of candidates) {
    try {
      const metadata = await runServerStart(command)
      if (await checkHealth(metadata.url, metadata.password ?? undefined, metadata.username ?? undefined)) return metadata
    } catch {}
  }
}

function runServerStart(command: string) {
  return new Promise<ExternalServerMetadata>((resolve, reject) => {
    const child = spawn(command, ["server", "start", "--json"], {
      env: createExternalServerEnv(),
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")))
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")))
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `opencode server start exited with code ${code}`))
        return
      }
      try {
        const lines = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        resolve(JSON.parse(lines.at(-1) ?? stdout) as ExternalServerMetadata)
      } catch (error) {
        reject(error)
      }
    })
  })
}

export async function findOrStartSharedServer() {
  const metadata = await readSharedServerMetadata()
  if (metadata && (await checkHealth(metadata.url, metadata.password, metadata.username ?? undefined))) return metadata
  return startSharedServerFromCli()
}

export function preferAppEnv(_userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  Object.assign(process.env, {
    ...(shell ? loadShellEnv(shell) : null),
    OPENCODE_CLIENT: "desktop",
  })
}

export async function checkHealth(url: string, password?: string | null, username = "opencode"): Promise<boolean> {
  let healthUrl: URL
  try {
    healthUrl = new URL("/global/health", url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`${username}:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

function createExternalServerEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if (process.platform === "linux") delete env.LD_PRELOAD
  return env
}
