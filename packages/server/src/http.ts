import { createServer as createTcpServer } from "node:net"
import { createToken, isAuthorized, unauthorized, writeServerMetadata } from "./auth"
import { openAgentHome } from "./home"
import { OpenAgentRuntime } from "./runtime"
import type { RuntimeContext, RuntimeResult } from "./types"

export type ServerOptions = {
  host?: string
  port?: number
  token?: string
  home?: string
  runtime?: OpenAgentRuntime
}

function json(data: unknown, init: ResponseInit = {}) {
  const extra: Record<string, string> = {}
  if (init.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      extra[key] = value
    })
  } else if (Array.isArray(init.headers)) {
    for (const [key, value] of init.headers) extra[key] = value
  } else if (init.headers) {
    Object.assign(extra, init.headers)
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-openagent-directory",
      "access-control-expose-headers": "x-next-cursor",
      ...extra,
    },
  })
}

async function readInput(request: Request) {
  if (request.method === "GET") return undefined
  const text = await request.text()
  if (!text) return undefined
  return JSON.parse(text)
}

function contextFromRequest(request: Request): RuntimeContext {
  const directory = request.headers.get("x-openagent-directory") || undefined
  return { directory }
}

function eventStream(runtime: OpenAgentRuntime, request: Request) {
  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      send("ready", { ok: true })
      unsubscribe = runtime.events.on((directory, event) => {
        send("message", { directory, event })
      })
      request.signal.addEventListener("abort", () => {
        unsubscribe()
        controller.close()
      })
    },
    cancel() {
      unsubscribe()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    },
  })
}

async function resolveEphemeralPort(host: string) {
  return await new Promise<number>((resolve, reject) => {
    const probe = createTcpServer()
    probe.once("error", reject)
    probe.listen(0, host, () => {
      const address = probe.address()
      const port = typeof address === "object" && address ? address.port : undefined
      probe.close((error) => {
        if (error) reject(error)
        else if (port) resolve(port)
        else reject(new Error("Could not resolve ephemeral port"))
      })
    })
  })
}

export async function startServer(options: ServerOptions = {}) {
  const host = options.host ?? process.env.OPENAGENT_HOST ?? "127.0.0.1"
  const optionPort = options.port ?? (process.env.OPENAGENT_PORT ? Number(process.env.OPENAGENT_PORT) : undefined)
  const configuredPort = optionPort === 0 ? await resolveEphemeralPort(host) : optionPort
  const home = options.home ?? openAgentHome()
  const token = options.token ?? process.env.OPENAGENT_TOKEN ?? createToken()
  const runtime = options.runtime ?? new OpenAgentRuntime()

  const serve = (port: number) =>
    Bun.serve({
      hostname: host,
      port,
      async fetch(request) {
        if (request.method === "OPTIONS") return json({ ok: true })
        const url = new URL(request.url)
        if (url.pathname === "/health") {
          return json({
            healthy: true,
            version: "openagent-server",
          })
        }
        if (!isAuthorized(request, token)) return unauthorized()
        if (url.pathname === "/events") return eventStream(runtime, request)
        if (url.pathname.startsWith("/rpc/") && request.method === "POST") {
          const method = decodeURIComponent(url.pathname.slice("/rpc/".length))
          const result = await runtime.call(method, await readInput(request), contextFromRequest(request))
          const headers: Record<string, string> = {}
          if (method === "session.messages") {
            const data = result.data as { cursor?: string; items?: unknown[] } | undefined
            if (data?.cursor) headers["x-next-cursor"] = data.cursor
            if (data && "items" in data) {
              return json({ data: data.items, error: result.error }, { headers })
            }
          }
          return json(result, { status: result.error ? 400 : 200, headers })
        }
        return json({ error: { message: "Not found", code: "NOT_FOUND" } } satisfies RuntimeResult, { status: 404 })
      },
    })

  let server: ReturnType<typeof Bun.serve> | undefined
  let lastError: unknown
  const fixedPort = configuredPort !== undefined ? configuredPort : undefined
  for (let attempt = 0; attempt < (fixedPort !== undefined ? 1 : 25); attempt++) {
    const port = fixedPort ?? 39100 + Math.floor(Math.random() * 20000)
    try {
      server = serve(port)
      break
    } catch (error) {
      lastError = error
      if (fixedPort !== undefined) throw error
    }
  }
  if (!server) throw lastError ?? new Error("Could not start OpenAgent server")

  const metadata = {
    url: `http://${host}:${server.port}`,
    host,
    port: Number(server.port),
    token,
    pid: process.pid,
    updated: Date.now(),
  }
  await writeServerMetadata(metadata, home)
  runtime.events.emit("global", { type: "server.connected", properties: { url: metadata.url } })

  return {
    server,
    runtime,
    metadata,
    stop() {
      void server.stop(true)
    },
  }
}
