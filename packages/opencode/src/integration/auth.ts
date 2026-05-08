import path from "path"
import { Effect, Layer, Schema, Context, Option } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export const Provider = Schema.Literals(["composio", "google", "fal", "openai"])
export type Provider = Schema.Schema.Type<typeof Provider>

export const Connection = Schema.Struct({
  provider: Provider,
  connectionID: Schema.String,
  accountID: Schema.String,
  label: Schema.optional(Schema.String),
  scopes: Schema.Array(Schema.String),
  accessToken: Schema.optional(Schema.String),
  refreshToken: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type Connection = Schema.Schema.Type<typeof Connection>

const Pending = Schema.Struct({
  provider: Provider,
  connectionID: Schema.String,
  accountID: Schema.String,
  state: Schema.String,
  scopes: Schema.Array(Schema.String),
  authorizationUrl: Schema.String,
  createdAt: Schema.Number,
})
type Pending = Schema.Schema.Type<typeof Pending>

const Store = Schema.Struct({
  connections: Schema.Array(Connection),
  pending: Schema.Array(Pending),
})
type Store = Schema.Schema.Type<typeof Store>

export const StartInput = Schema.Struct({
  provider: Provider,
  accountID: Schema.optional(Schema.String),
  connectionID: Schema.optional(Schema.String),
  scopes: Schema.optional(Schema.Array(Schema.String)),
  redirectURI: Schema.optional(Schema.String),
})
export type StartInput = Schema.Schema.Type<typeof StartInput>

export const CallbackInput = Schema.Struct({
  provider: Provider,
  state: Schema.String,
  code: Schema.String,
  accountID: Schema.optional(Schema.String),
  connectionID: Schema.optional(Schema.String),
})
export type CallbackInput = Schema.Schema.Type<typeof CallbackInput>

export interface Interface {
  readonly list: (accountID?: string) => Effect.Effect<Connection[]>
  readonly get: (input: { provider: Provider; accountID?: string; connectionID?: string }) => Effect.Effect<Connection | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Pending>
  readonly callback: (input: CallbackInput) => Effect.Effect<Connection>
  readonly revoke: (input: { provider: Provider; accountID?: string; connectionID?: string }) => Effect.Effect<boolean>
  readonly status: (input: { provider: Provider; accountID?: string; connectionID?: string }) => Effect.Effect<
    | { status: "connected"; connection: Omit<Connection, "accessToken" | "refreshToken"> }
    | { status: "needs_connection"; provider: Provider; setup: string }
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/IntegrationAuth") {}

const filepath = path.join(Global.Path.data, "integration-auth.json")
const defaultAccount = "local"

function publicConnection(connection: Connection): Omit<Connection, "accessToken" | "refreshToken"> {
  const { accessToken: _, refreshToken: __, ...rest } = connection
  return rest
}

function setup(provider: Provider) {
  if (provider === "composio") {
    return [
      "Connect Composio for this user from the integrations UI or API.",
      "Required app setup: COMPOSIO_CLIENT_ID and COMPOSIO_CLIENT_SECRET.",
      "After OAuth completes, Virtual Assistant tools can execute connected-account actions with permission prompts.",
    ].join("\n")
  }
  if (provider === "google") return "Connect Google OAuth for this user or set GOOGLE_API_KEY for provider-level media tools."
  if (provider === "fal") return "Connect fal.ai for this user or set FAL_KEY for provider-level media tools."
  return "Connect OpenAI for this user or set OPENAI_API_KEY for provider-level media tools."
}

function oauthUrl(input: StartInput & { state: string; connectionID: string; accountID: string }) {
  if (input.provider === "composio") {
    const clientID = process.env.COMPOSIO_CLIENT_ID
    if (!clientID) return `opencode://integrations/composio/setup?state=${encodeURIComponent(input.state)}`
    const redirect = input.redirectURI ?? "http://localhost:4096/integration/composio/oauth/callback"
    const params = new URLSearchParams({
      client_id: clientID,
      redirect_uri: redirect,
      response_type: "code",
      state: input.state,
      scope: (input.scopes ?? []).join(" "),
    })
    return `https://backend.composio.dev/api/v1/auth-apps/oauth2/authorize?${params}`
  }
  return `opencode://integrations/${input.provider}/setup?state=${encodeURIComponent(input.state)}`
}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Store)

    const read = Effect.fn("IntegrationAuth.read")(function* () {
      const raw = yield* fs.readJson(filepath).pipe(Effect.orElseSucceed(() => undefined))
      const parsed = decode(raw)
      return Option.isSome(parsed) ? parsed.value : ({ connections: [], pending: [] } satisfies Store)
    })

    const write = Effect.fn("IntegrationAuth.write")(function* (store: Store) {
      yield* fs.writeJson(filepath, store, 0o600).pipe(Effect.orDie)
    })

    const list = Effect.fn("IntegrationAuth.list")(function* (accountID?: string) {
      const store = yield* read()
      const account = accountID ?? defaultAccount
      return store.connections.filter((item: Connection) => item.accountID === account)
    })

    const get: Interface["get"] = Effect.fn("IntegrationAuth.get")(function* (input) {
      const account = input.accountID ?? defaultAccount
      const connection = input.connectionID ?? "default"
      const store = yield* read()
      return store.connections.find(
        (item: Connection) => item.provider === input.provider && item.accountID === account && item.connectionID === connection,
      )
    })

    const start = Effect.fn("IntegrationAuth.start")(function* (input: StartInput) {
      const accountID = input.accountID ?? defaultAccount
      const connectionID = input.connectionID ?? "default"
      const state = crypto.randomUUID()
      const pending = {
        provider: input.provider,
        accountID,
        connectionID,
        state,
        scopes: input.scopes ?? [],
        authorizationUrl: oauthUrl({ ...input, state, accountID, connectionID }),
        createdAt: Date.now(),
      } satisfies Pending
      const store = yield* read()
      yield* write({
        connections: store.connections,
        pending: [...store.pending.filter((item: Pending) => item.state !== state), pending],
      })
      return pending
    })

    const callback = Effect.fn("IntegrationAuth.callback")(function* (input: CallbackInput) {
      const store = yield* read()
      const pending = store.pending.find((item: Pending) => item.provider === input.provider && item.state === input.state)
      if (!pending) throw new Error(`No pending OAuth flow for ${input.provider}`)
      const connection = {
        provider: pending.provider,
        accountID: input.accountID ?? pending.accountID,
        connectionID: input.connectionID ?? pending.connectionID,
        scopes: pending.scopes,
        accessToken: `oauth-code:${input.code}`,
        label: `${pending.provider}:${pending.connectionID}`,
        metadata: { tokenSource: "oauth_callback_pending_exchange" },
      } satisfies Connection
      yield* write({
        pending: store.pending.filter((item: Pending) => item.state !== input.state),
        connections: [
          ...store.connections.filter(
            (item: Connection) =>
              !(
                item.provider === connection.provider &&
                item.accountID === connection.accountID &&
                item.connectionID === connection.connectionID
              ),
          ),
          connection,
        ],
      })
      return connection
    })

    const revoke: Interface["revoke"] = Effect.fn("IntegrationAuth.revoke")(function* (input) {
      const accountID = input.accountID ?? defaultAccount
      const connectionID = input.connectionID ?? "default"
      const store = yield* read()
      const next = store.connections.filter(
        (item: Connection) => !(item.provider === input.provider && item.accountID === accountID && item.connectionID === connectionID),
      )
      yield* write({ ...store, connections: next })
      return next.length !== store.connections.length
    })

    const status: Interface["status"] = Effect.fn("IntegrationAuth.status")(function* (input) {
      const connection = yield* get(input)
      if (!connection) return { status: "needs_connection" as const, provider: input.provider, setup: setup(input.provider) }
      return { status: "connected" as const, connection: publicConnection(connection) }
    })

    return Service.of({ list, get, start, callback, revoke, status })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as IntegrationAuth from "./auth"
