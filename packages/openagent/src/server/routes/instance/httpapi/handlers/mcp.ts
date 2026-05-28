import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { AddPayload, AuthCallbackPayload, StatusMap, UnsupportedOAuthError } from "../groups/mcp"

type McpEntry = NonNullable<Config.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry | undefined): entry is Extract<McpEntry, { type: string }> {
  return typeof entry === "object" && entry !== null && "type" in entry
}

function hasInferredLocalOAuth(entry: Extract<McpEntry, { type: "local" }>) {
  return entry.transport?.type === "streamable-http" && entry.oauth !== false && entry.environment?.MCP_ENABLE_OAUTH21 === "true"
}

function unsupportedOAuthMessage(name: string, entry: McpEntry | undefined) {
  if (!entry) {
    return `MCP server ${name} is not configured in this workspace. Install or reinstall the extension, then restart OpenAgent if it was just installed.`
  }

  if (!isMcpConfigured(entry)) {
    return `MCP server ${name} is only configured as a disabled placeholder. Reinstall the extension so its full MCP config is written.`
  }

  if (entry.type === "builtin") {
    return `MCP server ${name} is a built-in server and does not support OAuth. Use Connect instead of Authenticate.`
  }

  if (entry.type === "remote") {
    if (entry.oauth === false) return `MCP server ${name} has OAuth explicitly disabled with oauth: false.`
    return `MCP server ${name} is not OAuth-capable according to its current remote MCP config.`
  }

  if (entry.transport?.type !== "streamable-http") {
    return `MCP server ${name} is a local stdio MCP server without OAuth support. Local OAuth requires transport.type="streamable-http" and oauth: {}.`
  }

  if (typeof entry.oauth !== "object" && !hasInferredLocalOAuth(entry)) {
    return `MCP server ${name} is configured for streamable HTTP but is missing oauth: {}. Its installed extension config is stale; remove and reinstall the extension.`
  }

  return `MCP server ${name} does not support OAuth with its current MCP config.`
}

export const mcpHandlers = HttpApiBuilder.group(InstanceHttpApi, "mcp", (handlers) =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const config = yield* Config.Service

    const status = Effect.fn("McpHttpApi.status")(function* () {
      return yield* mcp.status()
    })

    const add = Effect.fn("McpHttpApi.add")(function* (ctx: { payload: typeof AddPayload.Type }) {
      const result = (yield* mcp.add(ctx.payload.name, ctx.payload.config)).status
      return yield* Schema.decodeUnknownEffect(StatusMap)(
        "status" in result ? { [ctx.payload.name]: result } : result,
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const authStart = Effect.fn("McpHttpApi.authStart")(function* (ctx: { params: { name: string } }) {
      if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
        const cfg = yield* config.get()
        return yield* new UnsupportedOAuthError({
          error: unsupportedOAuthMessage(ctx.params.name, cfg.mcp?.[ctx.params.name]),
        })
      }
      return yield* mcp.startAuth(ctx.params.name)
    })

    const authCallback = Effect.fn("McpHttpApi.authCallback")(function* (ctx: {
      params: { name: string }
      payload: typeof AuthCallbackPayload.Type
    }) {
      return yield* mcp.finishAuth(ctx.params.name, ctx.payload.code)
    })

    const authAuthenticate = Effect.fn("McpHttpApi.authAuthenticate")(function* (ctx: { params: { name: string } }) {
      if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
        const cfg = yield* config.get()
        return yield* new UnsupportedOAuthError({
          error: unsupportedOAuthMessage(ctx.params.name, cfg.mcp?.[ctx.params.name]),
        })
      }
      return yield* mcp.authenticate(ctx.params.name)
    })

    const authRemove = Effect.fn("McpHttpApi.authRemove")(function* (ctx: { params: { name: string } }) {
      yield* mcp.removeAuth(ctx.params.name)
      return { success: true as const }
    })

    const connect = Effect.fn("McpHttpApi.connect")(function* (ctx: { params: { name: string } }) {
      yield* mcp.connect(ctx.params.name)
      return true
    })

    const disconnect = Effect.fn("McpHttpApi.disconnect")(function* (ctx: { params: { name: string } }) {
      yield* mcp.disconnect(ctx.params.name)
      return true
    })

    return handlers
      .handle("status", status)
      .handle("add", add)
      .handle("authStart", authStart)
      .handle("authCallback", authCallback)
      .handle("authAuthenticate", authAuthenticate)
      .handle("authRemove", authRemove)
      .handle("connect", connect)
      .handle("disconnect", disconnect)
  }),
)
