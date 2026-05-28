import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export class NotConnectedError extends Error {
  constructor(message = "The frontend shell is not connected to a runtime service.") {
    super(message)
    this.name = "NotConnectedError"
  }
}

type RuntimeResult<T = unknown> = {
  data?: T
  error?: unknown
}

const notConnected = () => new NotConnectedError()

const emptyPath = () => ({
  state: "",
  config: "",
  worktree: "",
  directory: "",
  home: "",
})

const result = <T>(data: T): Promise<RuntimeResult<T>> => Promise.resolve({ data })
const rejectedAction = (): Promise<RuntimeResult> => Promise.resolve({ error: notConnected() })

const queryDefaults = new Map<string, () => unknown>([
  ["global.health", () => ({ healthy: true, version: "frontend-only" })],
  ["global.config.get", () => ({})],
  ["config.get", () => ({})],
  ["project.list", () => []],
  ["project.opened", () => []],
  ["path.get", emptyPath],
  ["provider.list", () => ({ all: [], connected: [], default: {} })],
  ["provider.auth", () => ({})],
  ["app.agents", () => []],
  ["session.list", () => []],
  ["session.children", () => []],
  ["session.messages", () => []],
  ["session.diff", () => []],
  ["session.todo", () => []],
  ["session.status", () => ({})],
  ["permission.list", () => []],
  ["question.list", () => []],
  ["mcp.status", () => ({})],
  ["lsp.status", () => []],
  ["file.list", () => []],
  ["file.read", () => undefined],
  ["find.files", () => []],
  ["worktree.list", () => []],
  ["experimental.console.get", () => ({
    activeOrgName: undefined,
    consoleManagedProviders: [],
    switchableOrgCount: 0,
  })],
  ["experimental.console.listOrgs", () => ({ orgs: [] })],
  ["experimental.extensions.list", () => ({ installed: [], available: [], servers: {} })],
  ["experimental.plugins.list", () => []],
  ["experimental.chat.list", () => []],
])

const queryNames = new Set(["get", "list", "opened", "messages", "diff", "todo", "status", "agents", "health", "auth"])

function makeRuntimeNode(path: string[] = []): any {
  const fn = (..._args: unknown[]) => {
    const key = path.join(".")
    const fallback = queryNames.has(path[path.length - 1] ?? "") ? () => undefined : undefined
    const data = (queryDefaults.get(key) ?? fallback)?.()
    return data === undefined && !fallback ? rejectedAction() : result(data)
  }

  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === "then") return undefined
      if (prop === Symbol.toStringTag) return "NullRuntimeClient"
      return makeRuntimeNode([...path, String(prop)])
    },
    apply() {
      return fn()
    },
  })
}

export type RuntimeClient = ReturnType<typeof createNullRuntimeClient>

export function createNullRuntimeClient() {
  return makeRuntimeNode() as any
}

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server: _server,
  ..._config
}: {
  server: ServerConnection.HttpBase
  directory?: string
  experimental_workspaceID?: string
  throwOnError?: boolean
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit
}) {
  return createNullRuntimeClient()
}
