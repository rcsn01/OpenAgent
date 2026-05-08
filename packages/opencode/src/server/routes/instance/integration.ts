import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { IntegrationAuth } from "@/integration/auth"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const Provider = z.enum(["composio", "google", "fal", "openai"])

const StartBody = z.object({
  provider: Provider,
  accountID: z.string().optional(),
  connectionID: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  redirectURI: z.string().optional(),
})

const CallbackBody = z.object({
  provider: Provider,
  state: z.string(),
  code: z.string(),
  accountID: z.string().optional(),
  connectionID: z.string().optional(),
})

export const IntegrationRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List integration connections",
        description: "List per-user external integration connections without exposing raw tokens.",
        operationId: "integration.list",
        responses: {
          200: {
            description: "Connections",
            content: { "application/json": { schema: resolver(z.array(z.record(z.string(), z.any()))) } },
          },
        },
      }),
      validator("query", z.object({ accountID: z.string().optional() })),
      async (c) =>
        jsonRequest("IntegrationRoutes.list", c, function* () {
          const svc = yield* IntegrationAuth.Service
          const accountID = c.req.valid("query").accountID
          const connections = yield* svc.list(accountID)
          return connections.map(({ accessToken: _, refreshToken: __, ...rest }) => rest)
        }),
    )
    .get(
      "/:provider/status",
      describeRoute({
        summary: "Get integration status",
        description: "Report whether an integration is connected and provide setup guidance when missing.",
        operationId: "integration.status",
        responses: {
          200: {
            description: "Integration status",
            content: { "application/json": { schema: resolver(z.record(z.string(), z.any())) } },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ provider: Provider })),
      validator("query", z.object({ accountID: z.string().optional(), connectionID: z.string().optional() })),
      async (c) =>
        jsonRequest("IntegrationRoutes.status", c, function* () {
          const svc = yield* IntegrationAuth.Service
          const provider = c.req.valid("param").provider
          const query = c.req.valid("query")
          return yield* svc.status({ provider, accountID: query.accountID, connectionID: query.connectionID })
        }),
    )
    .post(
      "/oauth/start",
      describeRoute({
        summary: "Start integration OAuth",
        description: "Start a per-user OAuth flow for an external integration.",
        operationId: "integration.oauth.start",
        responses: {
          200: {
            description: "OAuth flow",
            content: { "application/json": { schema: resolver(z.record(z.string(), z.any())) } },
          },
          ...errors(400),
        },
      }),
      validator("json", StartBody),
      async (c) =>
        jsonRequest("IntegrationRoutes.oauth.start", c, function* () {
          const svc = yield* IntegrationAuth.Service
          return yield* svc.start(c.req.valid("json"))
        }),
    )
    .post(
      "/oauth/callback",
      describeRoute({
        summary: "Complete integration OAuth",
        description: "Complete a per-user OAuth flow and store the resulting connection.",
        operationId: "integration.oauth.callback",
        responses: {
          200: {
            description: "Connected integration",
            content: { "application/json": { schema: resolver(z.record(z.string(), z.any())) } },
          },
          ...errors(400),
        },
      }),
      validator("json", CallbackBody),
      async (c) =>
        jsonRequest("IntegrationRoutes.oauth.callback", c, function* () {
          const svc = yield* IntegrationAuth.Service
          const { accessToken: _, refreshToken: __, ...connection } = yield* svc.callback(c.req.valid("json"))
          return connection
        }),
    )
    .delete(
      "/:provider",
      describeRoute({
        summary: "Revoke integration",
        description: "Remove a per-user integration connection.",
        operationId: "integration.revoke",
        responses: {
          200: {
            description: "Revocation result",
            content: { "application/json": { schema: resolver(z.object({ revoked: z.boolean() })) } },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ provider: Provider })),
      validator("query", z.object({ accountID: z.string().optional(), connectionID: z.string().optional() })),
      async (c) =>
        jsonRequest("IntegrationRoutes.revoke", c, function* () {
          const svc = yield* IntegrationAuth.Service
          const provider = c.req.valid("param").provider
          const query = c.req.valid("query")
          return { revoked: yield* svc.revoke({ provider, accountID: query.accountID, connectionID: query.connectionID }) }
        }),
    ),
)
