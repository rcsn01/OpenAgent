import { test, expect, mock, beforeEach } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { MCP as MCPNS } from "../../src/mcp/index"

// --- Mock infrastructure ---

// Per-client state for controlling mock behavior
interface MockClientState {
  tools: Array<{ name: string; description?: string; inputSchema: object }>
  listToolsCalls: number
  listToolsShouldFail: boolean
  listToolsError: string
  listPromptsShouldFail: boolean
  listResourcesShouldFail: boolean
  prompts: Array<{ name: string; description?: string }>
  resources: Array<{ name: string; uri: string; description?: string }>
  closed: boolean
  notificationHandlers: Map<unknown, (...args: any[]) => any>
}

const clientStates = new Map<string, MockClientState>()
let lastCreatedClientName: string | undefined
let connectShouldFail = false
let connectShouldHang = false
let connectError = "Mock transport cannot connect"
let connectFailuresRemaining = 0
// Tracks how many Client instances were created (detects leaks)
let clientCreateCount = 0
// Tracks how many times transport.close() is called across all mock transports
let transportCloseCount = 0
const httpTransportCalls: Array<{ url: string }> = []
const spawnCalls: Array<{ command: string; args: string[]; env: Record<string, string> | undefined }> = []
let spawnKillCount = 0
let mockedPort = 43123

function getOrCreateClientState(name?: string): MockClientState {
  const key = name ?? "default"
  let state = clientStates.get(key)
  if (!state) {
    state = {
      tools: [{ name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: {} } }],
      listToolsCalls: 0,
      listToolsShouldFail: false,
      listToolsError: "listTools failed",
      listPromptsShouldFail: false,
      listResourcesShouldFail: false,
      prompts: [],
      resources: [],
      closed: false,
      notificationHandlers: new Map(),
    }
    clientStates.set(key, state)
  }
  return state
}

// Mock transport that succeeds or fails based on connectShouldFail / connectShouldHang
class MockStdioTransport {
  stderr: null = null
  pid = 12345
  // oxlint-disable-next-line no-useless-constructor
  constructor(_opts: any) {}
  async start() {
    if (connectShouldHang) return new Promise<void>(() => {}) // never resolves
    if (connectShouldFail) throw new Error(connectError)
    if (connectFailuresRemaining > 0) {
      connectFailuresRemaining--
      throw new Error(connectError)
    }
  }
  async close() {
    transportCloseCount++
  }
}

class MockStreamableHTTP {
  // oxlint-disable-next-line no-useless-constructor
  constructor(url: URL, _opts?: any) {
    httpTransportCalls.push({ url: url.toString() })
  }
  async start() {
    if (connectShouldHang) return new Promise<void>(() => {}) // never resolves
    if (connectShouldFail) throw new Error(connectError)
    if (connectFailuresRemaining > 0) {
      connectFailuresRemaining--
      throw new Error(connectError)
    }
  }
  async close() {
    transportCloseCount++
  }
  async finishAuth() {}
}

class MockSSE {
  // oxlint-disable-next-line no-useless-constructor
  constructor(_url: URL, _opts?: any) {}
  async start() {
    if (connectShouldHang) return new Promise<void>(() => {}) // never resolves
    if (connectShouldFail) throw new Error(connectError)
  }
  async close() {
    transportCloseCount++
  }
}

void mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioTransport,
}))

void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTP,
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockSSE,
}))

void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {
    constructor() {
      super("Unauthorized")
    }
  },
}))

void mock.module("net", () => ({
  createServer: () => {
    let port = mockedPort
    return {
      address: () => ({ port }),
      close: (callback?: (error?: Error) => void) => callback?.(),
      listen: (_port: number, _host: string, callback?: () => void) => {
        port = mockedPort
        callback?.()
      },
      once: () => undefined,
    }
  },
}))

// Mock Client that delegates to per-name MockClientState
void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    _state!: MockClientState
    transport: any

    constructor(_opts: any) {
      clientCreateCount++
    }

    async connect(transport: { start: () => Promise<void> }) {
      this.transport = transport
      await transport.start()
      // After successful connect, bind to the last-created client name
      this._state = getOrCreateClientState(lastCreatedClientName)
    }

    setNotificationHandler(schema: unknown, handler: (...args: any[]) => any) {
      this._state?.notificationHandlers.set(schema, handler)
    }

    async listTools() {
      if (this._state) this._state.listToolsCalls++
      if (this._state?.listToolsShouldFail) {
        throw new Error(this._state.listToolsError)
      }
      return { tools: this._state?.tools ?? [] }
    }

    async listPrompts() {
      if (this._state?.listPromptsShouldFail) {
        throw new Error("listPrompts failed")
      }
      return { prompts: this._state?.prompts ?? [] }
    }

    async listResources() {
      if (this._state?.listResourcesShouldFail) {
        throw new Error("listResources failed")
      }
      return { resources: this._state?.resources ?? [] }
    }

    async close() {
      if (this._state) this._state.closed = true
    }
  },
}))

beforeEach(() => {
  clientStates.clear()
  lastCreatedClientName = undefined
  connectShouldFail = false
  connectShouldHang = false
  connectError = "Mock transport cannot connect"
  connectFailuresRemaining = 0
  clientCreateCount = 0
  transportCloseCount = 0
  httpTransportCalls.length = 0
  spawnCalls.length = 0
  spawnKillCount = 0
  mockedPort = 43123
})

// Import after mocks
const { MCP } = await import("../../src/mcp/index")
const { Bus } = await import("../../src/bus")
const { Config } = await import("../../src/config/config")
const { McpAuth } = await import("../../src/mcp/auth")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

// --- Helper ---

function withInstance(
  config: Record<string, unknown>,
  fn: (mcp: MCPNS.Interface) => Effect.Effect<void, unknown, never>,
  layer = MCP.defaultLayer,
) {
  return async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcp: config,
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Effect.runPromise(MCP.Service.use(fn).pipe(Effect.provide(layer)))
        // dispose instance to clean up state between tests
        await Instance.dispose()
      },
    })
  }
}

function mockSpawner() {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const std = ChildProcess.isStandardCommand(command) ? command : undefined
      spawnCalls.push({
        command: std?.command ?? "",
        args: std?.args ? [...std.args] : [],
        env: (std as any)?.options?.env ? { ...((std as any).options.env as Record<string, string>) } : undefined,
      })

      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(43210),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(true),
          kill: () => {
            spawnKillCount++
            return Effect.void
          },
          stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      )
    }),
  )
}

const localHttpLayer = MCP.layer.pipe(
  Layer.provide(McpAuth.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(mockSpawner()),
  Layer.provide(AppFileSystem.defaultLayer),
)

// ========================================================================
// Test: tools() are cached after connect
// ========================================================================

test(
  "tools() reuses cached tool definitions after connect",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "my-server"
      const serverState = getOrCreateClientState("my-server")
      serverState.tools = [
        { name: "do_thing", description: "does a thing", inputSchema: { type: "object", properties: {} } },
      ]

      // First: add the server successfully
      const addResult = yield* mcp.add("my-server", {
        type: "local",
        command: ["echo", "test"],
      })
      expect((addResult.status as any)["my-server"]?.status ?? (addResult.status as any).status).toBe("connected")

      expect(serverState.listToolsCalls).toBe(1)

      const toolsA = yield* mcp.tools()
      const toolsB = yield* mcp.tools()
      expect(Object.keys(toolsA).length).toBeGreaterThan(0)
      expect(Object.keys(toolsB).length).toBeGreaterThan(0)
      expect(serverState.listToolsCalls).toBe(1)
    }),
  ),
)

// ========================================================================
// Test: tool change notifications refresh the cache
// ========================================================================

test(
  "tool change notifications refresh cached tool definitions",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "status-server"
      const serverState = getOrCreateClientState("status-server")

      yield* mcp.add("status-server", {
        type: "local",
        command: ["echo", "test"],
      })

      const before = yield* mcp.tools()
      expect(Object.keys(before).some((key) => key.includes("test_tool"))).toBe(true)
      expect(serverState.listToolsCalls).toBe(1)

      serverState.tools = [{ name: "next_tool", description: "next", inputSchema: { type: "object", properties: {} } }]

      const handler = Array.from(serverState.notificationHandlers.values())[0]
      expect(handler).toBeDefined()
      yield* Effect.promise(() => handler?.())

      const after = yield* mcp.tools()
      expect(Object.keys(after).some((key) => key.includes("next_tool"))).toBe(true)
      expect(Object.keys(after).some((key) => key.includes("test_tool"))).toBe(false)
      expect(serverState.listToolsCalls).toBe(2)
    }),
  ),
)

// ========================================================================
// Test: connect() / disconnect() lifecycle
// ========================================================================

test(
  "disconnect sets status to disabled and removes client",
  withInstance(
    {
      "disc-server": {
        type: "local",
        command: ["echo", "test"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "disc-server"
        getOrCreateClientState("disc-server")

        yield* mcp.add("disc-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const statusBefore = yield* mcp.status()
        expect(statusBefore["disc-server"]?.status).toBe("connected")

        yield* mcp.disconnect("disc-server")

        const statusAfter = yield* mcp.status()
        expect(statusAfter["disc-server"]?.status).toBe("disabled")

        // Tools should be empty after disconnect
        const tools = yield* mcp.tools()
        const serverTools = Object.keys(tools).filter((k) => k.startsWith("disc-server"))
        expect(serverTools.length).toBe(0)
      }),
  ),
)

test(
  "connect() after disconnect() re-establishes the server",
  withInstance(
    {
      "reconn-server": {
        type: "local",
        command: ["echo", "test"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "reconn-server"
        const serverState = getOrCreateClientState("reconn-server")
        serverState.tools = [
          { name: "my_tool", description: "a tool", inputSchema: { type: "object", properties: {} } },
        ]

        yield* mcp.add("reconn-server", {
          type: "local",
          command: ["echo", "test"],
        })

        yield* mcp.disconnect("reconn-server")
        expect((yield* mcp.status())["reconn-server"]?.status).toBe("disabled")

        // Reconnect
        yield* mcp.connect("reconn-server")
        expect((yield* mcp.status())["reconn-server"]?.status).toBe("connected")

        const tools = yield* mcp.tools()
        expect(Object.keys(tools).some((k) => k.includes("my_tool"))).toBe(true)
      }),
  ),
)

test(
  "connect() uses spawned streamable-http local MCPs and cleans them up on disconnect",
  withInstance(
    {},
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "local-http-server"
        getOrCreateClientState("local-http-server")

        const added = yield* mcp.add("local-http-server", {
          type: "local",
          command: ["uvx", "workspace-mcp", "--transport", "streamable-http"],
          transport: {
            type: "streamable-http",
            host: "127.0.0.1",
            path: "/mcp",
            portEnv: "WORKSPACE_MCP_PORT",
          },
          oauth: {},
        } as any)

        expect((added.status as Record<string, { status: string }>)["local-http-server"]?.status).toBe("connected")
        expect(spawnCalls).toHaveLength(1)
        expect(spawnCalls[0]?.command).toBe("uvx")
        expect(spawnCalls[0]?.env?.WORKSPACE_MCP_PORT).toMatch(/^\d+$/)
        expect(httpTransportCalls.some((call) => call.url.startsWith("http://127.0.0.1:") && call.url.endsWith("/mcp"))).toBe(
          true,
        )

        yield* mcp.disconnect("local-http-server")

        const clientsAfter = yield* mcp.clients()
        expect(clientsAfter["local-http-server"]).toBeUndefined()
        expect(spawnKillCount).toBeGreaterThanOrEqual(1)
      }),
    localHttpLayer,
  ),
)

test(
  "connect() marks local OAuth MCPs as needing setup when Google client ID is missing",
  withInstance(
    {},
    (mcp) =>
      Effect.gen(function* () {
        const added = yield* mcp.add("local-http-missing-google-client", {
          type: "local",
          command: ["uvx", "workspace-mcp", "--transport", "streamable-http"],
          transport: {
            type: "streamable-http",
            host: "127.0.0.1",
            path: "/mcp",
            portEnv: "WORKSPACE_MCP_PORT",
          },
          oauth: {},
          environment: {
            MCP_ENABLE_OAUTH21: "true",
            GOOGLE_OAUTH_CLIENT_ID: "",
          },
        } as any)

        expect((added.status as Record<string, { status: string }>)["local-http-missing-google-client"]?.status).toBe(
          "needs_client_registration",
        )
        expect(spawnCalls).toHaveLength(0)
      }),
    localHttpLayer,
  ),
)

test(
  "connect() injects a signing key for local OAuth 2.1 MCPs with public PKCE clients",
  withInstance(
    {},
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "local-http-public-pkce"
        getOrCreateClientState("local-http-public-pkce")

        const added = yield* mcp.add("local-http-public-pkce", {
          type: "local",
          command: ["uvx", "workspace-mcp", "--transport", "streamable-http"],
          transport: {
            type: "streamable-http",
            host: "127.0.0.1",
            path: "/mcp",
            portEnv: "WORKSPACE_MCP_PORT",
          },
          oauth: {},
          environment: {
            MCP_ENABLE_OAUTH21: "true",
            GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
          },
        } as any)

        expect((added.status as Record<string, { status: string }>)["local-http-public-pkce"]?.status).toBe("connected")
        expect(spawnCalls[0]?.env?.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY).toMatch(/^[a-f0-9]{64}$/)
      }),
    localHttpLayer,
  ),
)

test(
  "connect() retries spawned streamable-http local MCPs until the server is ready",
  withInstance(
    {},
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "local-http-retry-server"
        getOrCreateClientState("local-http-retry-server")
        connectFailuresRemaining = 2
        connectError = "fetch failed\nCaused by: connect ECONNREFUSED 127.0.0.1:43123 failed"

        const added = yield* mcp.add("local-http-retry-server", {
          type: "local",
          command: ["uvx", "workspace-mcp", "--transport", "streamable-http"],
          transport: {
            type: "streamable-http",
            host: "127.0.0.1",
            path: "/mcp",
            portEnv: "WORKSPACE_MCP_PORT",
          },
          oauth: {},
        } as any)

        expect((added.status as Record<string, { status: string }>)["local-http-retry-server"]?.status).toBe("connected")
        expect(httpTransportCalls.filter((call) => call.url.endsWith("/mcp"))).toHaveLength(3)
      }),
    localHttpLayer,
  ),
)

// ========================================================================
// Test: add() closes existing client before replacing
// ========================================================================

test(
  "add() closes the old client when replacing a server",
  // Don't put the server in config — add it dynamically so we control
  // exactly which client instance is "first" vs "second".
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "replace-server"
      const firstState = getOrCreateClientState("replace-server")

      yield* mcp.add("replace-server", {
        type: "local",
        command: ["echo", "test"],
      })

      expect(firstState.closed).toBe(false)

      // Create new state for second client
      clientStates.delete("replace-server")
      const secondState = getOrCreateClientState("replace-server")

      // Re-add should close the first client
      yield* mcp.add("replace-server", {
        type: "local",
        command: ["echo", "test"],
      })

      expect(firstState.closed).toBe(true)
      expect(secondState.closed).toBe(false)
    }),
  ),
)

// ========================================================================
// Test: state init with mixed success/failure
// ========================================================================

test(
  "init connects available servers even when one fails",
  withInstance(
    {
      "good-server": {
        type: "local",
        command: ["echo", "good"],
      },
      "bad-server": {
        type: "local",
        command: ["echo", "bad"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        // Set up good server
        const goodState = getOrCreateClientState("good-server")
        goodState.tools = [{ name: "good_tool", description: "works", inputSchema: { type: "object", properties: {} } }]

        // Set up bad server - will fail on listTools during create()
        const badState = getOrCreateClientState("bad-server")
        badState.listToolsShouldFail = true

        // Add good server first
        lastCreatedClientName = "good-server"
        yield* mcp.add("good-server", {
          type: "local",
          command: ["echo", "good"],
        })

        // Add bad server - should fail but not affect good server
        lastCreatedClientName = "bad-server"
        yield* mcp.add("bad-server", {
          type: "local",
          command: ["echo", "bad"],
        })

        const status = yield* mcp.status()
        expect(status["good-server"]?.status).toBe("connected")
        expect(status["bad-server"]?.status).toBe("failed")

        // Good server's tools should still be available
        const tools = yield* mcp.tools()
        expect(Object.keys(tools).some((k) => k.includes("good_tool"))).toBe(true)
      }),
  ),
)

// ========================================================================
// Test: disabled server via config
// ========================================================================

test(
  "disabled server is marked as disabled without attempting connection",
  withInstance(
    {
      "disabled-server": {
        type: "local",
        command: ["echo", "test"],
        enabled: false,
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        const countBefore = clientCreateCount

        yield* mcp.add("disabled-server", {
          type: "local",
          command: ["echo", "test"],
          enabled: false,
        } as any)

        // No client should have been created
        expect(clientCreateCount).toBe(countBefore)

        const status = yield* mcp.status()
        expect(status["disabled-server"]?.status).toBe("disabled")
      }),
  ),
)

// ========================================================================
// Test: prompts() and resources()
// ========================================================================

test(
  "prompts() returns prompts from connected servers",
  withInstance(
    {
      "prompt-server": {
        type: "local",
        command: ["echo", "test"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "prompt-server"
        const serverState = getOrCreateClientState("prompt-server")
        serverState.prompts = [{ name: "my-prompt", description: "A test prompt" }]

        yield* mcp.add("prompt-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const prompts = yield* mcp.prompts()
        expect(Object.keys(prompts).length).toBe(1)
        const key = Object.keys(prompts)[0]
        expect(key).toContain("prompt-server")
        expect(key).toContain("my-prompt")
      }),
  ),
)

test(
  "resources() returns resources from connected servers",
  withInstance(
    {
      "resource-server": {
        type: "local",
        command: ["echo", "test"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "resource-server"
        const serverState = getOrCreateClientState("resource-server")
        serverState.resources = [{ name: "my-resource", uri: "file:///test.txt", description: "A test resource" }]

        yield* mcp.add("resource-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const resources = yield* mcp.resources()
        expect(Object.keys(resources).length).toBe(1)
        const key = Object.keys(resources)[0]
        expect(key).toContain("resource-server")
        expect(key).toContain("my-resource")
      }),
  ),
)

test(
  "prompts() skips disconnected servers",
  withInstance(
    {
      "prompt-disc-server": {
        type: "local",
        command: ["echo", "test"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "prompt-disc-server"
        const serverState = getOrCreateClientState("prompt-disc-server")
        serverState.prompts = [{ name: "hidden-prompt", description: "Should not appear" }]

        yield* mcp.add("prompt-disc-server", {
          type: "local",
          command: ["echo", "test"],
        })

        yield* mcp.disconnect("prompt-disc-server")

        const prompts = yield* mcp.prompts()
        expect(Object.keys(prompts).length).toBe(0)
      }),
  ),
)

// ========================================================================
// Test: connect() on nonexistent server
// ========================================================================

test(
  "connect() on nonexistent server does not throw",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      // Should not throw
      yield* mcp.connect("nonexistent")
      const status = yield* mcp.status()
      expect(status["nonexistent"]).toBeUndefined()
    }),
  ),
)

// ========================================================================
// Test: disconnect() on nonexistent server
// ========================================================================

test(
  "disconnect() on nonexistent server does not throw",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      yield* mcp.disconnect("nonexistent")
      // Should complete without error
    }),
  ),
)

// ========================================================================
// Test: tools() with no MCP servers configured
// ========================================================================

test(
  "tools() returns empty when no MCP servers are configured",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      const tools = yield* mcp.tools()
      expect(Object.keys(tools).length).toBe(0)
    }),
  ),
)

// ========================================================================
// Test: connect failure during create()
// ========================================================================

test(
  "server that fails to connect is marked as failed",
  withInstance(
    {
      "fail-connect": {
        type: "local",
        command: ["echo", "test"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "fail-connect"
        getOrCreateClientState("fail-connect")
        connectShouldFail = true
        connectError = "Connection refused"

        yield* mcp.add("fail-connect", {
          type: "local",
          command: ["echo", "test"],
        })

        const status = yield* mcp.status()
        expect(status["fail-connect"]?.status).toBe("failed")
        if (status["fail-connect"]?.status === "failed") {
          expect(status["fail-connect"].error).toContain("Connection refused")
        }

        // No tools should be available
        const tools = yield* mcp.tools()
        expect(Object.keys(tools).length).toBe(0)
      }),
  ),
)

// ========================================================================
// Bug #5: McpOAuthCallback.cancelPending uses wrong key
// ========================================================================

test("McpOAuthCallback.cancelPending is keyed by mcpName but pendingAuths uses oauthState", async () => {
  const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")

  // Register a pending auth with an oauthState key, associated to an mcpName
  const oauthState = "abc123hexstate"
  const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, "my-mcp-server")

  // cancelPending is called with mcpName — should find the entry via reverse index
  McpOAuthCallback.cancelPending("my-mcp-server")

  // The callback should still be pending because cancelPending looked up
  // "my-mcp-server" in a map keyed by "abc123hexstate"
  let rejected = false
  callbackPromise.then(() => {}).catch(() => (rejected = true))

  // Give it a tick
  await new Promise((r) => setTimeout(r, 50))

  // cancelPending("my-mcp-server") should have rejected the pending callback
  expect(rejected).toBe(true)

  await McpOAuthCallback.stop()
})

// ========================================================================
// Test: multiple tools from same server get correct name prefixes
// ========================================================================

test(
  "tools() prefixes tool names with sanitized server name",
  withInstance(
    {
      "my.special-server": {
        type: "local",
        command: ["echo", "test"],
      },
    },
    (mcp) =>
      Effect.gen(function* () {
        lastCreatedClientName = "my.special-server"
        const serverState = getOrCreateClientState("my.special-server")
        serverState.tools = [
          { name: "tool-a", description: "Tool A", inputSchema: { type: "object", properties: {} } },
          { name: "tool.b", description: "Tool B", inputSchema: { type: "object", properties: {} } },
        ]

        yield* mcp.add("my.special-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const tools = yield* mcp.tools()
        const keys = Object.keys(tools)

        // Server name dots should be replaced with underscores
        expect(keys.some((k) => k.startsWith("my_special-server_"))).toBe(true)
        // Tool name dots should be replaced with underscores
        expect(keys.some((k) => k.endsWith("tool_b"))).toBe(true)
        expect(keys.length).toBe(2)
      }),
  ),
)

// ========================================================================
// Test: transport leak — local stdio timeout (#19168)
// ========================================================================

test(
  "local stdio transport is closed when connect times out (no process leak)",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "hanging-server"
      getOrCreateClientState("hanging-server")
      connectShouldHang = true

      const addResult = yield* mcp.add("hanging-server", {
        type: "local",
        command: ["node", "fake.js"],
        timeout: 100,
      })

      const serverStatus = (addResult.status as any)["hanging-server"] ?? addResult.status
      expect(serverStatus.status).toBe("failed")
      expect(serverStatus.error).toContain("timed out")
      // Transport must be closed to avoid orphaned child process
      expect(transportCloseCount).toBeGreaterThanOrEqual(1)
    }),
  ),
)

// ========================================================================
// Test: transport leak — remote timeout (#19168)
// ========================================================================

test(
  "remote transport is closed when connect times out",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "hanging-remote"
      getOrCreateClientState("hanging-remote")
      connectShouldHang = true

      const addResult = yield* mcp.add("hanging-remote", {
        type: "remote",
        url: "http://localhost:9999/mcp",
        timeout: 100,
        oauth: false,
      })

      const serverStatus = (addResult.status as any)["hanging-remote"] ?? addResult.status
      expect(serverStatus.status).toBe("failed")
      // Transport must be closed to avoid leaked HTTP connections
      expect(transportCloseCount).toBeGreaterThanOrEqual(1)
    }),
  ),
)

// ========================================================================
// Test: transport leak — failed remote transports not closed (#19168)
// ========================================================================

test(
  "failed remote transport is closed before trying next transport",
  withInstance({}, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "fail-remote"
      getOrCreateClientState("fail-remote")
      connectShouldFail = true
      connectError = "Connection refused"

      const addResult = yield* mcp.add("fail-remote", {
        type: "remote",
        url: "http://localhost:9999/mcp",
        timeout: 5000,
        oauth: false,
      })

      const serverStatus = (addResult.status as any)["fail-remote"] ?? addResult.status
      expect(serverStatus.status).toBe("failed")
      // Both StreamableHTTP and SSE transports should be closed
      expect(transportCloseCount).toBeGreaterThanOrEqual(2)
    }),
  ),
)
