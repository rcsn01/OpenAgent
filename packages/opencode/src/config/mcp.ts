import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { PositiveInt, withStatics } from "@/util/schema"

export const LocalTransportStreamableHTTP = Schema.Struct({
  type: Schema.Literal("streamable-http").annotate({
    description: "Connect to a locally spawned MCP server over streamable HTTP instead of stdio.",
  }),
  host: Schema.String.annotate({
    description: "Loopback host for the locally spawned HTTP MCP server.",
  }),
  path: Schema.String.annotate({
    description: "HTTP path for the locally spawned MCP server.",
  }),
  portEnv: Schema.String.annotate({
    description: "Environment variable name used to inject the chosen loopback port into the child process.",
  }),
})
  .annotate({ identifier: "McpLocalTransportStreamableHTTPConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type LocalTransportStreamableHTTP = Schema.Schema.Type<typeof LocalTransportStreamableHTTP>

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String).annotate({
    description: "OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.",
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: "OAuth client secret (if required by the authorization server)",
  }),
  scope: Schema.optional(Schema.String).annotate({ description: "OAuth scopes to request during authorization" }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: "OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).",
  }),
})
  .annotate({ identifier: "McpOAuthConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type OAuth = Schema.Schema.Type<typeof OAuth>

export const ToolFilter = Schema.Struct({
  allow_prefixes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Only expose MCP tools whose names start with one of these prefixes.",
  }),
  deny_prefixes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Hide MCP tools whose names start with one of these prefixes.",
  }),
})
  .annotate({ identifier: "McpToolFilterConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ToolFilter = Schema.Schema.Type<typeof ToolFilter>

export const Local = Schema.Struct({
  type: Schema.Literal("local").annotate({ description: "Type of MCP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the MCP server",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the MCP server",
  }),
  transport: Schema.optional(LocalTransportStreamableHTTP).annotate({
    description: "Optional transport override for locally spawned MCP servers. Defaults to stdio when omitted.",
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description:
      "OAuth authentication configuration for HTTP-based local MCP servers. Omit or set to false for non-OAuth local servers.",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
  tool_filter: Schema.optional(ToolFilter).annotate({
    description: "Optional MCP tool exposure filter applied after tools/list.",
  }),
})
  .annotate({ identifier: "McpLocalConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Local = Schema.Schema.Type<typeof Local>

export const Remote = Schema.Struct({
  type: Schema.Literal("remote").annotate({ description: "Type of MCP server connection" }),
  url: Schema.String.annotate({ description: "URL of the remote MCP server" }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Headers to send with the request",
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description: "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
  tool_filter: Schema.optional(ToolFilter).annotate({
    description: "Optional MCP tool exposure filter applied after tools/list.",
  }),
})
  .annotate({ identifier: "McpRemoteConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Remote = Schema.Schema.Type<typeof Remote>

export const Builtin = Schema.Struct({
  type: Schema.Literal("builtin").annotate({ description: "Built-in MCP server implemented by OpenAgent" }),
  id: Schema.Literal("computer-use").annotate({ description: "Built-in MCP capability identifier" }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the built-in MCP server on startup",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
  tool_filter: Schema.optional(ToolFilter).annotate({
    description: "Optional MCP tool exposure filter applied after tools/list.",
  }),
})
  .annotate({ identifier: "McpBuiltinConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Builtin = Schema.Schema.Type<typeof Builtin>

export const Info = Schema.Union([Local, Remote, Builtin])
  .annotate({ discriminator: "type" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigMCP from "./mcp"
