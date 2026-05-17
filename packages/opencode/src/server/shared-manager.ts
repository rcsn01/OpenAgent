import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { Flock } from "@opencode-ai/core/util/flock"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Database } from "@/storage/db"
import { ServerAuth } from "@/server/auth"

const STATE_DIR = path.join(Global.Path.state, "openagent-server")
const METADATA_FILE = path.join(STATE_DIR, "server.json")
const START_TIMEOUT = 30_000

export type Metadata = {
  pid: number
  url: string
  username: string
  password: string
  dbPath: string
  startedAt: string
  version: string
}

export type Status =
  | { status: "running"; metadata: Metadata; health?: unknown }
  | { status: "stale"; metadata: Metadata; reason: string }
  | { status: "missing" }

function metadataPath() {
  return METADATA_FILE
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "")
}

function envUrl() {
  const raw = process.env.OPENAGENT_SERVER_URL || process.env.OPENCODE_SERVER_URL
  if (!raw?.trim()) return
  return normalizeUrl(raw)
}

function credentials(metadata?: Pick<Metadata, "username" | "password">) {
  if (metadata?.password) return { username: metadata.username, password: metadata.password }
  return {
    username: process.env.OPENCODE_SERVER_USERNAME,
    password: process.env.OPENCODE_SERVER_PASSWORD,
  }
}

function headers(metadata?: Pick<Metadata, "username" | "password">) {
  return ServerAuth.headers(credentials(metadata))
}

async function readMetadata(): Promise<Metadata | undefined> {
  try {
    const parsed = JSON.parse(await readFile(metadataPath(), "utf8")) as Partial<Metadata>
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.url !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.password !== "string" ||
      typeof parsed.dbPath !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.version !== "string"
    ) {
      return
    }
    return parsed as Metadata
  } catch {
    return
  }
}

async function writeMetadata(metadata: Metadata) {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  await writeFile(metadataPath(), JSON.stringify(metadata, null, 2), { mode: 0o600 })
}

async function removeMetadata() {
  await rm(metadataPath(), { force: true }).catch(() => undefined)
}

async function checkHealth(url: string, metadata?: Pick<Metadata, "username" | "password">) {
  try {
    const response = await fetch(new URL("/global/health", url), {
      headers: headers(metadata),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return { ok: false as const, reason: `HTTP ${response.status}` }
    return { ok: true as const, body: await response.json().catch(() => undefined) }
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) }
  }
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to allocate a server port"))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function entrypoint() {
  return fileURLToPath(new URL("../index.ts", import.meta.url))
}

function serveCommand(port: number) {
  const serveArgs = ["serve", "--hostname", "127.0.0.1", "--port", String(port)]
  if (path.basename(process.execPath).toLowerCase().includes("bun")) {
    return {
      cmd: process.execPath,
      args: ["run", "--conditions=browser", entrypoint(), ...serveArgs],
    }
  }
  return {
    cmd: process.execPath,
    args: serveArgs,
  }
}

async function waitForHealthy(metadata: Metadata) {
  const deadline = Date.now() + START_TIMEOUT
  let last = "not checked"
  while (Date.now() < deadline) {
    const health = await checkHealth(metadata.url, metadata)
    if (health.ok) return
    last = health.reason
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for shared server: ${last}`)
}

async function spawnServer() {
  const port = await freePort()
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode"
  const password = process.env.OPENCODE_SERVER_PASSWORD || randomUUID()
  const url = `http://127.0.0.1:${port}`
  const command = serveCommand(port)
  const child = spawn(command.cmd, command.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
      OPENAGENT_SERVER_CHILD: "1",
    },
  })
  child.unref()

  const metadata: Metadata = {
    pid: child.pid ?? 0,
    url,
    username,
    password,
    dbPath: Database.getPath(),
    startedAt: new Date().toISOString(),
    version: InstallationVersion,
  }
  await waitForHealthy(metadata)
  await writeMetadata(metadata)
  return metadata
}

export function forcedUrl() {
  return envUrl()
}

export function authorizationHeaders(metadata: Pick<Metadata, "username" | "password"> | undefined) {
  return headers(metadata)
}

export async function ensure(): Promise<Metadata> {
  const forced = envUrl()
  if (forced) {
    return {
      pid: 0,
      url: forced,
      username: process.env.OPENCODE_SERVER_USERNAME || "opencode",
      password: process.env.OPENCODE_SERVER_PASSWORD || "",
      dbPath: Database.getPath(),
      startedAt: new Date().toISOString(),
      version: InstallationVersion,
    }
  }

  return Flock.withLock(`openagent-server:${Hash.fast(Database.getPath())}`, async () => {
    const existing = await readMetadata()
    if (existing && existing.dbPath === Database.getPath()) {
      const health = await checkHealth(existing.url, existing)
      if (health.ok) return existing
      await removeMetadata()
    }
    return spawnServer()
  })
}

export async function status(): Promise<Status> {
  const metadata = await readMetadata()
  if (!metadata) return { status: "missing" }
  const health = await checkHealth(metadata.url, metadata)
  if (health.ok) return { status: "running", metadata, health: health.body }
  return { status: "stale", metadata, reason: health.reason }
}

export async function start() {
  return ensure()
}

export async function stop() {
  const metadata = await readMetadata()
  if (!metadata) return false
  try {
    process.kill(metadata.pid, "SIGTERM")
  } catch {}
  await removeMetadata()
  return true
}

export async function doctor() {
  const current = await status()
  return {
    stateDir: STATE_DIR,
    metadataFile: METADATA_FILE,
    dbPath: Database.getPath(),
    forcedUrl: envUrl(),
    status: current,
  }
}

export * as SharedServer from "./shared-manager"
