import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "@/config/config"
import { ConfigMCP } from "../config/mcp"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import z from "zod/v4"
import { Installation } from "../installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { withTimeout } from "@/util/timeout"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import open from "open"
import { Effect, Exit, Layer, Option, Context, Schema, Scope, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { zod as effectZod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { createServer } from "net"

const log = Log.create({ service: "mcp" })
const DEFAULT_TIMEOUT = 30_000
const LOCAL_HTTP_STARTUP_GRACE_MS = 5_000
const LOCAL_HTTP_STARTUP_RETRY_DELAY_MS = 100

export const Resource = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  client: Schema.String,
})
  .annotate({ identifier: "McpResource" })
  .pipe(withStatics((s) => ({ zod: effectZod(s) })))
export type Resource = Schema.Schema.Type<typeof Resource>

export const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  Schema.Struct({
    server: Schema.String,
  }),
)

export const BrowserOpenFailed = BusEvent.define(
  "mcp.browser.open.failed",
  Schema.Struct({
    mcpName: Schema.String,
    url: Schema.String,
  }),
)

export const Failed = NamedError.create(
  "MCPFailed",
  z.object({
    name: z.string(),
  }),
)

type MCPClient = Client

const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCPStatusConnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCPStatusDisabled",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCPStatusFailed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCPStatusNeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCPStatusNeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
])
  .annotate({ identifier: "MCPStatus", discriminator: "status" })
  .pipe(withStatics((s) => ({ zod: effectZod(s) })))
export type Status = Schema.Schema.Type<typeof Status>

// Store transports for OAuth servers to allow finishing auth
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
type Cleanup = Effect.Effect<void, never, never>
type PendingOAuthSession = {
  transport: TransportWithAuth
  cleanup: Cleanup
}
const pendingOAuthSessions = new Map<string, PendingOAuthSession>()

// Prompt cache types
type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
type McpEntry = NonNullable<Config.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry): entry is ConfigMCP.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

function remoteURL(key: string, value: string) {
  if (URL.canParse(value)) return new URL(value)
  log.warn("invalid remote mcp url", { key })
}

function localHTTPTransport(mcp: ConfigMCP.Local) {
  return mcp.transport?.type === "streamable-http" ? mcp.transport : undefined
}

function supportsOAuthConfig(mcp: ConfigMCP.Info) {
  if (mcp.type === "remote") return mcp.oauth !== false
  return !!localHTTPTransport(mcp) && typeof mcp.oauth === "object"
}

function oauthConfig(mcp: ConfigMCP.Info) {
  return typeof mcp.oauth === "object" ? mcp.oauth : undefined
}

function missingLocalOAuthEnvironment(mcp: ConfigMCP.Local) {
  if (!supportsOAuthConfig(mcp) || mcp.environment?.MCP_ENABLE_OAUTH21 !== "true") return []
  if (!("GOOGLE_OAUTH_CLIENT_ID" in (mcp.environment ?? {}))) return []
  return mcp.environment.GOOGLE_OAUTH_CLIENT_ID.trim() ? [] : ["GOOGLE_OAUTH_CLIENT_ID"]
}

function localOAuthEnvironmentStatus(mcpName: string, mcp: ConfigMCP.Local): Status | undefined {
  const missing = missingLocalOAuthEnvironment(mcp)
  if (!missing.length) return
  return {
    status: "needs_client_registration",
    error: `${missing.join(", ")} is not available to the OpenCode app process. Set it before launching OpenCode Desktop, then reconnect ${mcpName}.`,
  }
}

function localHTTPPath(value: string) {
  return value.startsWith("/") ? value : `/${value}`
}

function stableLocalOAuthServerURL(name: string, transport: ConfigMCP.LocalTransportStreamableHTTP) {
  return `local-streamable-http://${encodeURIComponent(name)}${localHTTPPath(transport.path)}`
}

// Convert MCP tool definition to AI SDK Tool type
function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Tool {
  const inputSchema = mcpTool.inputSchema

  // Spread first, then override type to ensure it's always "object"
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout,
        },
      )
    },
  })
}

function defs(key: string, client: MCPClient, timeout?: number) {
  return Effect.tryPromise({
    try: () => withTimeout(client.listTools(), timeout ?? DEFAULT_TIMEOUT),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  }).pipe(
    Effect.map((result) => result.tools),
    Effect.catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return Effect.succeed(undefined)
    }),
  )
}

function fetchFromClient<T extends { name: string }>(
  clientName: string,
  client: Client,
  listFn: (c: Client) => Promise<T[]>,
  label: string,
) {
  return Effect.tryPromise({
    try: () => listFn(client),
    catch: (e: any) => {
      log.error(`failed to get ${label}`, { clientName, error: e.message })
      return e
    },
  }).pipe(
    Effect.map((items) => {
      const out: Record<string, T & { client: string }> = {}
      const sanitizedClient = sanitize(clientName)
      for (const item of items) {
        out[sanitizedClient + ":" + sanitize(item.name)] = { ...item, client: clientName }
      }
      return out
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

interface CreateResult {
  mcpClient?: MCPClient
  status: Status
  defs?: MCPToolDef[]
  cleanup?: Cleanup
}

interface AuthResult {
  authorizationUrl: string
  oauthState: string
  client?: MCPClient
  cleanup?: Cleanup
  status?: Status
}

// --- Effect Service ---

interface State {
  status: Record<string, Status>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
  cleanups: Record<string, Cleanup>
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>
  readonly definitions: () => Effect.Effect<Record<string, MCPToolDef[]>>
  readonly tools: () => Effect.Effect<Record<string, Tool>>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly add: (name: string, mcp: ConfigMCP.Info) => Effect.Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect.Effect<void>
  readonly disconnect: (name: string) => Effect.Effect<void>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
  readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>
  readonly authenticate: (mcpName: string) => Effect.Effect<Status>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MCP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const auth = yield* McpAuth.Service
    const bus = yield* Bus.Service

    type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

    /**
     * Connect a client via the given transport with resource safety:
     * on failure the transport is closed; on success the caller owns it.
     */
    const connectTransport = (transport: Transport, timeout: number) =>
      Effect.acquireUseRelease(
        Effect.succeed(transport),
        (t) =>
          Effect.tryPromise({
            try: () => {
              const client = new Client({ name: "opencode", version: InstallationVersion })
              return withTimeout(client.connect(t), timeout).then(() => client)
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
        (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
      )

    function isRetryableLocalHTTPError(error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("ECONNRESET")
    }

    function connectLocalHTTPTransport(
      key: string,
      url: URL,
      timeout: number,
      makeTransport: () => StreamableHTTPClientTransport,
      remainingMs = Math.max(timeout, LOCAL_HTTP_STARTUP_GRACE_MS),
      attempt = 0,
    ): Effect.Effect<MCPClient, Error, never> {
      return connectTransport(makeTransport(), timeout).pipe(
        Effect.catch((error) => {
          const next = error instanceof Error ? error : new Error(String(error))
          if (!isRetryableLocalHTTPError(next) || remainingMs <= 0) return Effect.fail(next)
          const wait = Math.min(LOCAL_HTTP_STARTUP_RETRY_DELAY_MS, remainingMs)
          log.debug("local http mcp not ready yet", {
            key,
            url: url.toString(),
            attempt: attempt + 1,
            error: next.message,
            wait,
          })
          return Effect.sleep(`${wait} millis`).pipe(
            Effect.andThen(connectLocalHTTPTransport(key, url, timeout, makeTransport, remainingMs - wait, attempt + 1)),
          )
        }),
      )
    }

    function closePendingOAuth(mcpName: string) {
      const session = pendingOAuthSessions.get(mcpName)
      if (!session) return Effect.void
      pendingOAuthSessions.delete(mcpName)
      return Effect.all([Effect.tryPromise(() => session.transport.close()).pipe(Effect.ignore), session.cleanup], {
        concurrency: "unbounded",
        discard: true,
      })
    }

    function reserveLocalPort(host: string) {
      return Effect.tryPromise({
        try: () =>
          new Promise<number>((resolve, reject) => {
            const server = createServer()
            server.once("error", reject)
            server.listen(0, host, () => {
              const address = server.address()
              if (!address || typeof address === "string") {
                server.close()
                reject(new Error(`Could not reserve a local port for ${host}`))
                return
              }
              server.close((error) => {
                if (error) {
                  reject(error)
                  return
                }
                resolve(address.port)
              })
            })
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    }

    function oauthWarning(key: string, message: string, status: Status) {
      return bus.publish(TuiEvent.ToastShow, {
        title: "MCP Authentication Required",
        message,
        variant: "warning",
        duration: 8000,
      }).pipe(Effect.ignore, Effect.as(status))
    }

    const connectLocalHTTPProcess = Effect.fn("MCP.connectLocalHTTPProcess")(function* (
      key: string,
      mcp: ConfigMCP.Local,
    ) {
      const transport = localHTTPTransport(mcp)
      if (!transport) throw new Error(`Local MCP ${key} is not configured for streamable HTTP`)

      const [command, ...args] = mcp.command
      const cwd = yield* InstanceState.directory
      const port = yield* reserveLocalPort(transport.host)
      const scope = yield* Scope.make()
      const childEnv: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        ),
        ...(command === "opencode" ? { BUN_BE_BUN: "1" } : {}),
        ...mcp.environment,
        [transport.portEnv]: String(port),
        PORT: String(port),
      }
      const env =
        childEnv.MCP_ENABLE_OAUTH21 === "true" && !childEnv.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY
          ? {
              ...childEnv,
              FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY: Array.from(crypto.getRandomValues(new Uint8Array(32)))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(""),
            }
          : childEnv
      const handle = yield* Scope.provide(scope)(
        spawner.spawn(
          ChildProcess.make(command, args, {
            cwd,
            extendEnv: true,
            stdin: "ignore",
            stderr: "pipe",
            forceKillAfter: "3 seconds",
            env,
          }),
        ),
      )

      yield* Scope.provide(scope)(
        Stream.decodeText(handle.stderr).pipe(
          Stream.splitLines,
          Stream.runForEach((line) =>
            Effect.sync(() => {
              if (line.trim()) log.warn("local http mcp stderr", { key, line })
            }),
          ),
          Effect.forkScoped,
        ),
      )

      return {
        cleanup: handle.kill().pipe(
          Effect.ignore,
          Effect.andThen(Scope.close(scope, Exit.void).pipe(Effect.ignore)),
        ),
        serverUrl: stableLocalOAuthServerURL(key, transport),
        url: new URL(localHTTPPath(transport.path), `http://${transport.host}:${port}`),
      }
    })

    const startOAuthTransport = Effect.fn("MCP.startOAuthTransport")(function* (
      mcpName: string,
      input: {
        cleanup?: Cleanup
        config?: ConfigMCP.OAuth
        local?: boolean
        serverUrl: string
        timeout?: number
        url: URL
      },
    ) {
      yield* closePendingOAuth(mcpName)
      yield* Effect.promise(() => McpOAuthCallback.ensureRunning(input.config?.redirectUri))

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      yield* auth.updateOAuthState(mcpName, oauthState)

      let authorizationUrl: URL | undefined
      const authProvider = new McpOAuthProvider(
        mcpName,
        input.serverUrl,
        {
          clientId: input.config?.clientId,
          clientSecret: input.config?.clientSecret,
          scope: input.config?.scope,
          redirectUri: input.config?.redirectUri,
        },
        {
          onRedirect: async (url) => {
            authorizationUrl = url
          },
        },
        auth,
      )
      let transport: StreamableHTTPClientTransport | undefined
      const connect = () =>
        (input.local
          ? connectLocalHTTPTransport(mcpName, input.url, input.timeout ?? DEFAULT_TIMEOUT, () => {
              transport = new StreamableHTTPClientTransport(input.url, { authProvider })
              return transport
            })
          : connectTransport(
              ((transport = new StreamableHTTPClientTransport(input.url, { authProvider })), transport),
              input.timeout ?? DEFAULT_TIMEOUT,
            )).pipe(
          Effect.map((client) => ({ authorizationUrl: "", cleanup: input.cleanup, oauthState, client }) satisfies AuthResult),
        )

      return yield* connect().pipe(
        Effect.catch((error) => {
          if (error instanceof UnauthorizedError && authorizationUrl && transport) {
            pendingOAuthSessions.set(mcpName, {
              transport,
              cleanup: input.cleanup ?? Effect.void,
            })
            return Effect.succeed({
              authorizationUrl: authorizationUrl.toString(),
              cleanup: input.cleanup,
              oauthState,
            } satisfies AuthResult)
          }
          return (input.cleanup ?? Effect.void).pipe(Effect.andThen(Effect.die(error)))
        }),
      )
    })

    const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

    const connectRemote = Effect.fn("MCP.connectRemote")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "remote" },
    ) {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      const url = remoteURL(key, mcp.url)
      if (!url) {
        return {
          mcpClient: undefined as MCPClient | undefined,
          status: { status: "failed" as const, error: `Invalid MCP URL for "${key}"` },
        } satisfies CreateResult
      }
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            redirectUri: oauthConfig?.redirectUri,
          },
          {
            onRedirect: async (url) => {
              log.info("oauth redirect requested", { key, url: url.toString() })
            },
          },
          auth,
        )
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      let lastStatus: Status | undefined

      for (const { name, transport } of transports) {
        const result = yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client) => ({ client, transportName: name })),
          Effect.catch((error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError =
              error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

            if (isAuthError) {
              log.info("mcp server requires authentication", { key, transport: name })

              if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                lastStatus = {
                  status: "needs_client_registration" as const,
                  error: "Server does not support dynamic client registration. Please provide clientId in config.",
                }
                return oauthWarning(
                  key,
                  `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                  lastStatus,
                ).pipe(Effect.as(undefined))
              }

              lastStatus = { status: "needs_auth" as const }
              return oauthWarning(
                key,
                `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                lastStatus,
              ).pipe(Effect.as(undefined))
            }

            log.debug("transport connection failed", {
              key,
              transport: name,
              url: mcp.url,
              error: lastError.message,
            })
            lastStatus = { status: "failed" as const, error: lastError.message }
            return Effect.succeed(undefined)
          }),
        )
        if (result) {
          log.info("connected", { key, transport: result.transportName })
          return {
            mcpClient: result.client as MCPClient | undefined,
            status: { status: "connected" } as Status,
          } satisfies CreateResult
        }
        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        mcpClient: undefined as MCPClient | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
      } satisfies CreateResult
    })

    const connectLocal = Effect.fn("MCP.connectLocal")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "local" },
    ) {
      const streamable = localHTTPTransport(mcp)
      if (streamable) {
        const environmentStatus = localOAuthEnvironmentStatus(key, mcp)
        if (environmentStatus) return { status: environmentStatus } satisfies CreateResult

        const local = yield* connectLocalHTTPProcess(key, mcp)
        const authProvider = supportsOAuthConfig(mcp)
          ? new McpOAuthProvider(
              key,
              local.serverUrl,
              {
                clientId: oauthConfig(mcp)?.clientId,
                clientSecret: oauthConfig(mcp)?.clientSecret,
                scope: oauthConfig(mcp)?.scope,
                redirectUri: oauthConfig(mcp)?.redirectUri,
              },
              {
                onRedirect: async (url) => {
                  log.info("oauth redirect requested", { key, url: url.toString() })
                },
              },
              auth,
            )
          : undefined

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        return yield* connectLocalHTTPTransport(
          key,
          local.url,
          connectTimeout,
          () => new StreamableHTTPClientTransport(local.url, authProvider ? { authProvider } : undefined),
        ).pipe(
          Effect.map((client): CreateResult => ({
            mcpClient: client,
            cleanup: local.cleanup,
            status: { status: "connected" },
          })),
          Effect.catch((error): Effect.Effect<CreateResult> => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError = authProvider && (error instanceof UnauthorizedError || lastError.message.includes("OAuth"))
            if (isAuthError) {
              return local.cleanup.pipe(
                Effect.andThen(
                  lastError.message.includes("registration") || lastError.message.includes("client_id")
                    ? oauthWarning(
                        key,
                        `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                        {
                          status: "needs_client_registration",
                          error:
                            "Server does not support dynamic client registration. Please provide clientId in config.",
                        },
                      )
                    : oauthWarning(key, `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`, {
                        status: "needs_auth",
                      }),
                ),
                Effect.map((status) => ({ status }) satisfies CreateResult),
              )
            }

            return local.cleanup.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  log.error("local http mcp startup failed", { key, command: mcp.command, url: local.url.toString() })
                }),
              ),
              Effect.as({ status: { status: "failed", error: lastError.message } } satisfies CreateResult),
            )
          }),
        )
      }

      const [cmd, ...args] = mcp.command
      const cwd = yield* InstanceState.directory
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })
      transport.stderr?.on("data", (chunk: Buffer) => {
        log.info(`mcp stderr: ${chunk.toString()}`, { key })
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      return yield* connectTransport(transport, connectTimeout).pipe(
        Effect.map((client): CreateResult => ({
          mcpClient: client,
          status: { status: "connected" },
        })),
        Effect.catch((error): Effect.Effect<CreateResult> => {
          const msg = error instanceof Error ? error.message : String(error)
          log.error("local mcp startup failed", { key, command: mcp.command, cwd, error: msg })
          return Effect.succeed({ status: { status: "failed", error: msg } })
        }),
      )
    })

    const create = Effect.fn("MCP.create")(function* (key: string, mcp: ConfigMCP.Info) {
      if (mcp.enabled === false) {
        log.info("mcp server disabled", { key })
        return DISABLED_RESULT
      }

      log.info("found", { key, type: mcp.type })

      const result: CreateResult =
        mcp.type === "remote"
          ? yield* connectRemote(key, mcp as ConfigMCP.Info & { type: "remote" })
          : yield* connectLocal(key, mcp as ConfigMCP.Info & { type: "local" })

      if (!result.mcpClient) {
        return { status: result.status } satisfies CreateResult
      }
      const client = result.mcpClient

      const listed = yield* defs(key, client, mcp.timeout)
      if (!listed) {
        yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
        yield* (result.cleanup ?? Effect.void)
        return { status: { status: "failed", error: "Failed to get tools" } } satisfies CreateResult
      }

      log.info("create() successfully created client", { key, toolCount: listed.length })
      return { mcpClient: client, cleanup: result.cleanup, status: result.status, defs: listed } satisfies CreateResult
    })
    const cfgSvc = yield* Config.Service

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === "win32") return [] as number[]
        const pids: number[] = []
        const queue = [pid]
        while (queue.length > 0) {
          const current = queue.shift()!
          const handle = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          for (const tok of text.split("\n")) {
            const cpid = parseInt(tok, 10)
            if (!isNaN(cpid) && !pids.includes(cpid)) {
              pids.push(cpid)
              queue.push(cpid)
            }
          }
        }
        return pids
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[])),
    )

    const closeManagedClient = Effect.fnUntraced(function* (client: MCPClient, cleanup?: Cleanup) {
      const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
      if (typeof pid === "number") {
        const pids = yield* descendants(pid)
        for (const childPid of pids) {
          try {
            process.kill(childPid, "SIGTERM")
          } catch {}
        }
      }
      yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      yield* (cleanup ?? Effect.void)
    })

    function watch(s: State, name: string, client: MCPClient, bridge: EffectBridge.Shape, timeout?: number) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        log.info("tools list changed notification received", { server: name })
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        const listed = await bridge.promise(defs(name, client, timeout))
        if (!listed) return
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        s.defs[name] = listed
        await bridge.promise(bus.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
      })
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("MCP.state")(function* () {
        const cfg = yield* cfgSvc.get()
        const bridge = yield* EffectBridge.make()
        const config = cfg.mcp ?? {}
        const s: State = {
          status: {},
          clients: {},
          defs: {},
          cleanups: {},
        }

        yield* Effect.forEach(
          Object.entries(config),
          ([key, mcp]) =>
            Effect.gen(function* () {
              if (!isMcpConfigured(mcp)) {
                log.error("Ignoring MCP config entry without type", { key })
                return
              }

              if (mcp.enabled === false) {
                s.status[key] = { status: "disabled" }
                return
              }

              const result = yield* create(key, mcp).pipe(Effect.catch(() => Effect.void))
              if (!result) return

              s.status[key] = result.status
              if (result.mcpClient) {
                s.clients[key] = result.mcpClient
                s.defs[key] = result.defs!
                s.cleanups[key] = result.cleanup ?? Effect.void
                watch(s, key, result.mcpClient, bridge, mcp.timeout)
              }
            }),
          { concurrency: "unbounded" },
        )

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Effect.forEach(
              Object.keys(s.clients),
              (name) =>
                closeManagedClient(s.clients[name]!, s.cleanups[name]).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      delete s.cleanups[name]
                    }),
                  ),
                ),
              { concurrency: "unbounded" },
            )
            yield* Effect.forEach(Array.from(pendingOAuthSessions.keys()), closePendingOAuth, {
              concurrency: "unbounded",
              discard: true,
            })
          }),
        )

        return s
      }),
    )

    function closeClient(s: State, name: string) {
      const client = s.clients[name]
      const cleanup = s.cleanups[name]
      delete s.cleanups[name]
      delete s.defs[name]
      delete s.clients[name]
      if (!client) return Effect.void
      return closeManagedClient(client, cleanup)
    }

    const storeClient = Effect.fnUntraced(function* (
      s: State,
      name: string,
      client: MCPClient,
      listed: MCPToolDef[],
      cleanup?: Cleanup,
      timeout?: number,
    ) {
      const bridge = yield* EffectBridge.make()
      yield* closeClient(s, name)
      s.status[name] = { status: "connected" }
      s.clients[name] = client
      s.defs[name] = listed
      s.cleanups[name] = cleanup ?? Effect.void
      watch(s, name, client, bridge, timeout)
      return s.status[name]
    })

    const status = Effect.fn("MCP.status")(function* () {
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const result: Record<string, Status> = {}

      for (const [key, mcp] of Object.entries(config)) {
        if (!isMcpConfigured(mcp)) continue
        result[key] = s.status[key] ?? { status: "disabled" }
      }

      return result
    })

    const clients = Effect.fn("MCP.clients")(function* () {
      const s = yield* InstanceState.get(state)
      return s.clients
    })

    const definitions = Effect.fn("MCP.definitions")(function* () {
      const s = yield* InstanceState.get(state)
      return s.defs
    })

    const createAndStore = Effect.fn("MCP.createAndStore")(function* (name: string, mcp: ConfigMCP.Info) {
      const s = yield* InstanceState.get(state)
      const result = yield* create(name, mcp)

      s.status[name] = result.status
      if (!result.mcpClient) {
        yield* closeClient(s, name)
        return result.status
      }

      return yield* storeClient(s, name, result.mcpClient, result.defs!, result.cleanup, mcp.timeout)
    })

    const add = Effect.fn("MCP.add")(function* (name: string, mcp: ConfigMCP.Info) {
      yield* createAndStore(name, mcp).pipe(Effect.orDie)
      const s = yield* InstanceState.get(state)
      return { status: s.status }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const mcp = yield* getMcpConfig(name)
      if (!mcp) {
        log.error("MCP config not found or invalid", { name })
        return
      }
      yield* createAndStore(name, { ...mcp, enabled: true }).pipe(Effect.orDie)
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      yield* closeClient(s, name)
      s.status[name] = { status: "disabled" }
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      const result: Record<string, Tool> = {}
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const defaultTimeout = cfg.experimental?.mcp_timeout

      const connectedClients = Object.entries(s.clients).filter(
        ([clientName]) => s.status[clientName]?.status === "connected",
      )

      yield* Effect.forEach(
        connectedClients,
        ([clientName, client]) =>
          Effect.gen(function* () {
            const mcpConfig = config[clientName]
            const entry = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig : undefined

            const listed = s.defs[clientName]
            if (!listed) {
              log.warn("missing cached tools for connected server", { clientName })
              return
            }

            const timeout = entry?.timeout ?? defaultTimeout
            for (const mcpTool of listed) {
              result[sanitize(clientName) + "_" + sanitize(mcpTool.name)] = convertMcpTool(mcpTool, client, timeout)
            }
          }),
        { concurrency: "unbounded" },
      )
      return result
    })

    function collectFromConnected<T extends { name: string }>(
      s: State,
      listFn: (c: Client) => Promise<T[]>,
      label: string,
    ) {
      return Effect.forEach(
        Object.entries(s.clients).filter(([name]) => s.status[name]?.status === "connected"),
        ([clientName, client]) =>
          fetchFromClient(clientName, client, listFn, label).pipe(Effect.map((items) => Object.entries(items ?? {}))),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
    }

    const prompts = Effect.fn("MCP.prompts")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, (c) => c.listPrompts().then((r) => r.prompts), "prompts")
    })

    const resources = Effect.fn("MCP.resources")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, (c) => c.listResources().then((r) => r.resources), "resources")
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: MCPClient) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>,
    ) {
      const s = yield* InstanceState.get(state)
      const client = s.clients[clientName]
      if (!client) {
        log.warn(`client not found for ${label}`, { clientName })
        return undefined
      }
      return yield* Effect.tryPromise({
        try: () => fn(client),
        catch: (e: any) => {
          log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message })
          return e
        },
      }).pipe(Effect.orElseSucceed(() => undefined))
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(clientName, (client) => client.getPrompt({ name, arguments: args }), "getPrompt", {
        promptName: name,
      })
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(clientName, (client) => client.readResource({ uri: resourceUri }), "readResource", {
        resourceUri,
      })
    })

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const cfg = yield* cfgSvc.get()
      const mcpConfig = cfg.mcp?.[mcpName]
      if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
      return mcpConfig
    })

    const beginAuth = Effect.fn("MCP.beginAuth")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
      if (!supportsOAuthConfig(mcpConfig)) throw new Error(`MCP server ${mcpName} does not support OAuth`)
      if (mcpConfig.type === "local") {
        const environmentStatus = localOAuthEnvironmentStatus(mcpName, mcpConfig)
        if (environmentStatus) {
          return {
            authorizationUrl: "",
            oauthState: "",
            cleanup: Effect.void,
            status: environmentStatus,
          } satisfies AuthResult
        }
      }

      if (mcpConfig.type === "remote") {
        const url = remoteURL(mcpName, mcpConfig.url)
        if (!url) throw new Error(`Invalid MCP URL for "${mcpName}"`)
        return yield* startOAuthTransport(mcpName, {
          config: oauthConfig(mcpConfig),
          timeout: mcpConfig.timeout,
          serverUrl: mcpConfig.url,
          url,
        })
      }

      const local = yield* connectLocalHTTPProcess(mcpName, mcpConfig)
      return yield* startOAuthTransport(mcpName, {
        cleanup: local.cleanup,
        config: oauthConfig(mcpConfig),
        local: true,
        timeout: mcpConfig.timeout,
        serverUrl: local.serverUrl,
        url: local.url,
      })
    })

    const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
      const result = yield* beginAuth(mcpName).pipe(Effect.orDie)
      return {
        authorizationUrl: result.authorizationUrl,
        oauthState: result.oauthState,
      }
    })

    const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
      const result = (yield* beginAuth(mcpName).pipe(Effect.orDie)) as AuthResult
      if (result.status) return result.status
      if (!result.authorizationUrl) {
        const client = "client" in result ? result.client : undefined
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          yield* (result.cleanup ?? Effect.void)
          return { status: "failed", error: "MCP config not found after auth" } as Status
        }

        const listed = client ? yield* defs(mcpName, client, mcpConfig.timeout) : undefined
        if (!client || !listed) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          yield* (result.cleanup ?? Effect.void)
          return { status: "failed", error: "Failed to get tools" } as Status
        }

        const s = yield* InstanceState.get(state)
        yield* auth.clearOAuthState(mcpName)
        return yield* storeClient(s, mcpName, client, listed, result.cleanup, mcpConfig.timeout)
      }

      log.info("opening browser for oauth", { mcpName, url: result.authorizationUrl, state: result.oauthState })

      const callbackPromise = McpOAuthCallback.waitForCallback(result.oauthState, mcpName)

      yield* Effect.tryPromise(() => open(result.authorizationUrl)).pipe(
        Effect.flatMap((subprocess) =>
          Effect.callback<void, Error>((resume) => {
            const timer = setTimeout(() => resume(Effect.void), 500)
            subprocess.on("error", (err) => {
              clearTimeout(timer)
              resume(Effect.fail(err))
            })
            subprocess.on("exit", (code) => {
              if (code !== null && code !== 0) {
                clearTimeout(timer)
                resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
              }
            })
          }),
        ),
        Effect.catch(() => {
          log.warn("failed to open browser, user must open URL manually", { mcpName })
          return bus.publish(BrowserOpenFailed, { mcpName, url: result.authorizationUrl }).pipe(Effect.ignore)
        }),
      )

      const code = yield* Effect.promise(() => callbackPromise).pipe(
        Effect.tapError(() => closePendingOAuth(mcpName)),
        Effect.orDie,
      )

      const storedState = yield* auth.getOAuthState(mcpName)
      if (storedState !== result.oauthState) {
        yield* auth.clearOAuthState(mcpName)
        yield* closePendingOAuth(mcpName)
        throw new Error("OAuth state mismatch - potential CSRF attack")
      }
      yield* auth.clearOAuthState(mcpName)
      return yield* finishAuth(mcpName, code).pipe(Effect.orDie)
    })

    const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
      const session = pendingOAuthSessions.get(mcpName)
      if (!session) return { status: "failed", error: `No pending OAuth flow for MCP server: ${mcpName}` } as Status

      const result = yield* Effect.tryPromise({
        try: () => session.transport.finishAuth(authorizationCode).then(() => true as const),
        catch: (error) => {
          log.error("failed to finish oauth", { mcpName, error })
          return error
        },
      }).pipe(Effect.option)

      if (Option.isNone(result)) {
        yield* closePendingOAuth(mcpName)
        return { status: "failed", error: "OAuth completion failed" } as Status
      }

      yield* auth.clearCodeVerifier(mcpName)
      yield* closePendingOAuth(mcpName)

      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return { status: "failed", error: "MCP config not found after auth" } as Status

      return yield* createAndStore(mcpName, mcpConfig).pipe(Effect.orDie)
    })

    const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
      yield* auth.remove(mcpName)
      McpOAuthCallback.cancelPending(mcpName)
      yield* closePendingOAuth(mcpName)
      log.info("removed oauth credentials", { mcpName })
    })

    const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return false
      return supportsOAuthConfig(mcpConfig)
    })

    const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      return !!entry?.tokens
    })

    const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      if (!entry?.tokens) return "not_authenticated" as AuthStatus
      const expired = yield* auth.isTokenExpired(mcpName)
      return (expired ? "expired" : "authenticated") as AuthStatus
    })

    return Service.of({
      status,
      clients,
      definitions,
      tools,
      prompts,
      resources,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth,
      authenticate,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus,
    })
  }),
)

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

// --- Per-service runtime ---

export const defaultLayer = layer.pipe(
  Layer.provide(McpAuth.layer),
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as MCP from "."
