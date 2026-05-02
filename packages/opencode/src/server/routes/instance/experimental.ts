import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import * as EffectZod from "@/util/effect-zod"
import { ProviderID, ModelID } from "@/provider/schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { MCP } from "@/mcp"
import { Session } from "@/session/session"
import { Config } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import { ConsoleState } from "@/config/console-state"
import { Account } from "@/account/account"
import { AccountID, OrgID } from "@/account/schema"
import { Filesystem } from "@/util/filesystem"
import { installPlugin, patchPluginConfig, readPluginManifest, setPluginEnabledInFile } from "@/plugin/install"
import { parsePluginSpecifier, pluginSource, resolvePathPluginTarget } from "@/plugin/shared"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect, Option } from "effect"
import { Agent } from "@/agent/agent"
import npa from "npm-package-arg"
import path from "path"
import { jsonRequest, runRequest } from "./trace"

const ConsoleOrgOption = z.object({
  accountID: z.string(),
  accountEmail: z.string(),
  accountUrl: z.string(),
  orgID: z.string(),
  orgName: z.string(),
  active: z.boolean(),
})

const ConsoleOrgList = z.object({
  orgs: z.array(ConsoleOrgOption),
})

const ConsoleSwitchBody = z.object({
  accountID: z.string(),
  orgID: z.string(),
})

const PluginTargetKind = z.enum(["server", "tui"])

const ExperimentalPlugin = z.object({
  spec: z.string(),
  packageName: z.string(),
  version: z.string().optional(),
  source: z.string(),
  scope: z.enum(["global", "local"]),
  kind: z.enum(["file", "npm"]),
  enabled: z.boolean(),
  editable: z.boolean(),
  installed: z.boolean(),
  target: z.string().optional(),
  targets: z.array(PluginTargetKind),
})

const ExperimentalPluginList = z.object({
  plugins: z.array(ExperimentalPlugin),
})

const ExperimentalPluginInstallBody = z.object({
  spec: z.string(),
  global: z.boolean().optional(),
  force: z.boolean().optional(),
})

const ExperimentalPluginStateBody = z.object({
  spec: z.string(),
  source: z.string(),
})

const QueryBoolean = z.union([
  z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean()),
  z.enum(["true", "false"]),
])

function queryBoolean(value: z.infer<typeof QueryBoolean> | undefined) {
  if (value === undefined) return
  return value === true || value === "true"
}

function editablePluginSource(source: string) {
  return (
    !source.startsWith("http://") &&
    !source.startsWith("https://") &&
    source !== "OPENCODE_CONFIG_CONTENT" &&
    !source.startsWith("file://")
  )
}

function npmCacheTarget(spec: string) {
  let key = spec
  try {
    const hit = npa(spec)
    if (hit?.name && hit.raw === hit.name) key = `${hit.name}@latest`
  } catch {}
  return path.join(Global.Path.cache, "packages", Npm.sanitize(key))
}

async function pluginTarget(spec: string) {
  if (pluginSource(spec) === "file") {
    return resolvePathPluginTarget(spec).catch(() => undefined)
  }

  const target = npmCacheTarget(spec)
  if (!(await Filesystem.exists(target))) return
  return target
}

function pluginError(
  result:
    | Exclude<Awaited<ReturnType<typeof readPluginManifest>>, { ok: true }>
    | Exclude<Awaited<ReturnType<typeof setPluginEnabledInFile>>, { ok: true }>
    | Exclude<Awaited<ReturnType<typeof patchPluginConfig>>, { ok: true }>,
): never {
  if (result.code === "manifest_read_failed") {
    throw new Error(`Failed to read plugin manifest from ${result.file}`)
  }
  if (result.code === "manifest_no_targets") {
    throw new Error(`Plugin ${result.file} does not expose plugin entrypoints`)
  }
  if (result.code === "plugin_not_found") {
    throw new Error(`Plugin ${result.spec} was not found in ${result.file}`)
  }
  if (result.code === "invalid_json") {
    throw new Error(`Invalid JSON in ${result.file} (${result.parse} at line ${result.line}, column ${result.col})`)
  }
  throw new Error("error" in result && result.error instanceof Error ? result.error.message : "Plugin update failed")
}

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/console",
      describeRoute({
        summary: "Get active Console provider metadata",
        description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
        operationId: "experimental.console.get",
        responses: {
          200: {
            description: "Active Console provider metadata",
            content: {
              "application/json": {
                schema: resolver(ConsoleState.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.get", c, function* () {
          const config = yield* Config.Service
          const account = yield* Account.Service
          const [state, groups] = yield* Effect.all([config.getConsoleState(), account.orgsByAccount()], {
            concurrency: "unbounded",
          })
          return {
            ...state,
            switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
          }
        }),
    )
    .get(
      "/console/orgs",
      describeRoute({
        summary: "List switchable Console orgs",
        description: "Get the available Console orgs across logged-in accounts, including the current active org.",
        operationId: "experimental.console.listOrgs",
        responses: {
          200: {
            description: "Switchable Console orgs",
            content: {
              "application/json": {
                schema: resolver(ConsoleOrgList),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.listOrgs", c, function* () {
          const account = yield* Account.Service
          const [groups, active] = yield* Effect.all([account.orgsByAccount(), account.active()], {
            concurrency: "unbounded",
          })
          const info = Option.getOrUndefined(active)
          const orgs = groups.flatMap((group) =>
            group.orgs.map((org) => ({
              accountID: group.account.id,
              accountEmail: group.account.email,
              accountUrl: group.account.url,
              orgID: org.id,
              orgName: org.name,
              active: !!info && info.id === group.account.id && info.active_org_id === org.id,
            })),
          )
          return { orgs }
        }),
    )
    .post(
      "/console/switch",
      describeRoute({
        summary: "Switch active Console org",
        description: "Persist a new active Console account/org selection for the current local OpenCode state.",
        operationId: "experimental.console.switchOrg",
        responses: {
          200: {
            description: "Switch success",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", ConsoleSwitchBody),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.switchOrg", c, function* () {
          const body = c.req.valid("json")
          const account = yield* Account.Service
          yield* account.use(AccountID.make(body.accountID), Option.some(OrgID.make(body.orgID)))
          return true
        }),
    )
    .get(
      "/plugins",
      describeRoute({
        summary: "List configured plugins",
        description: "Get configured GUI-manageable plugin metadata, including source, scope, targets, and enabled state.",
        operationId: "experimental.plugins.list",
        responses: {
          200: {
            description: "Configured plugins",
            content: {
              "application/json": {
                schema: resolver(ExperimentalPluginList),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.plugins.list", c, function* () {
          const config = yield* Config.Service
          const current = yield* config.get()
          const plugins = yield* Effect.promise(() =>
            Promise.all(
              (current.plugin_origins ?? []).map(async (origin) => {
                const spec = ConfigPlugin.pluginSpecifier(origin.spec)
                const target = await pluginTarget(spec)
                const manifest = target ? await readPluginManifest(target) : undefined
                const parsed = parsePluginSpecifier(spec)
                return {
                  spec,
                  packageName: parsed.pkg,
                  version: parsed.version || undefined,
                  source: origin.source,
                  scope: origin.scope,
                  kind: pluginSource(spec),
                  enabled: ConfigPlugin.pluginOptions(origin.spec)?.enabled !== false,
                  editable: editablePluginSource(origin.source),
                  installed: !!target,
                  target,
                  targets: manifest?.ok ? manifest.targets.map((item: { kind: "server" | "tui" }) => item.kind) : [],
                }
              }),
            ),
          )
          return { plugins }
        }),
    )
    .post(
      "/plugins/install",
      describeRoute({
        summary: "Install and configure a plugin",
        description: "Install a plugin package and update shared server plugin config for the current instance.",
        operationId: "experimental.plugins.install",
        responses: {
          200: {
            description: "Install success",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ExperimentalPluginInstallBody),
      async (c) =>
        jsonRequest("ExperimentalRoutes.plugins.install", c, function* () {
          const body = c.req.valid("json")
          const config = yield* Config.Service
          const target = yield* Effect.promise(() => installPlugin(body.spec))
          if (!target.ok) {
            throw new Error(`Failed to install plugin ${body.spec}`)
          }

          const manifest = yield* Effect.promise(() => readPluginManifest(target.target))
          if (!manifest.ok) pluginError(manifest)

          const serverTargets = manifest.targets.filter((item) => item.kind === "server")
          if (!serverTargets.length) {
            throw new Error(`Plugin ${body.spec} does not expose a server entrypoint`)
          }

          const patched = yield* Effect.promise(() =>
            patchPluginConfig({
              spec: body.spec,
              targets: serverTargets,
              force: body.force,
              global: body.global,
              vcs: Instance.project.vcs,
              worktree: Instance.worktree,
              directory: Instance.directory,
              config: Global.Path.config,
            }),
          )
          if (!patched.ok) pluginError(patched)

          yield* config.invalidate(true)
          return true
        }),
    )
    .post(
      "/plugins/enable",
      describeRoute({
        summary: "Enable a configured plugin",
        description: "Enable a plugin entry in its source config file.",
        operationId: "experimental.plugins.enable",
        responses: {
          200: {
            description: "Enable success",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ExperimentalPluginStateBody),
      async (c) =>
        jsonRequest("ExperimentalRoutes.plugins.enable", c, function* () {
          const body = c.req.valid("json")
          const config = yield* Config.Service
          const current = yield* config.get()
          const hit = (current.plugin_origins ?? []).find(
            (item) => item.source === body.source && ConfigPlugin.pluginSpecifier(item.spec) === body.spec,
          )
          if (!hit || !editablePluginSource(hit.source)) {
            throw new Error("Plugin configuration is not editable")
          }

          const result = yield* Effect.promise(() =>
            setPluginEnabledInFile({
              file: hit.source,
              spec: body.spec,
              enabled: true,
            }),
          )
          if (!result.ok) pluginError(result)

          yield* config.invalidate(true)
          return true
        }),
    )
    .post(
      "/plugins/disable",
      describeRoute({
        summary: "Disable a configured plugin",
        description: "Disable a plugin entry in its source config file.",
        operationId: "experimental.plugins.disable",
        responses: {
          200: {
            description: "Disable success",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ExperimentalPluginStateBody),
      async (c) =>
        jsonRequest("ExperimentalRoutes.plugins.disable", c, function* () {
          const body = c.req.valid("json")
          const config = yield* Config.Service
          const current = yield* config.get()
          const hit = (current.plugin_origins ?? []).find(
            (item) => item.source === body.source && ConfigPlugin.pluginSpecifier(item.spec) === body.spec,
          )
          if (!hit || !editablePluginSource(hit.source)) {
            throw new Error("Plugin configuration is not editable")
          }

          const result = yield* Effect.promise(() =>
            setPluginEnabledInFile({
              file: hit.source,
              spec: body.spec,
              enabled: false,
            }),
          )
          if (!result.ok) pluginError(result)

          yield* config.invalidate(true)
          return true
        }),
    )
    .get(
      "/tool/ids",
      describeRoute({
        summary: "List tool IDs",
        description:
          "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.tool.ids", c, function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.ids()
        }),
    )
    .get(
      "/tool",
      describeRoute({
        summary: "List tools",
        description:
          "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await runRequest(
          "ExperimentalRoutes.tool.list",
          c,
          Effect.gen(function* () {
            const agents = yield* Agent.Service
            const registry = yield* ToolRegistry.Service
            return yield* registry.tools({
              providerID: ProviderID.make(provider),
              modelID: ModelID.make(model),
              agent: yield* agents.get(yield* agents.defaultAgent()),
            })
          }),
        )
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            parameters: EffectZod.toJsonSchema(t.parameters),
          })),
        )
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project and run any configured startup scripts.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.CreateInput.zod.optional()),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.create", c, function* () {
          const body = c.req.valid("json")
          const svc = yield* Worktree.Service
          return yield* svc.create(body)
        }),
    )
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.list", c, function* () {
          const svc = yield* Project.Service
          return yield* svc.sandboxes(Instance.project.id)
        }),
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.RemoveInput.zod),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.remove", c, function* () {
          const body = c.req.valid("json")
          const worktree = yield* Worktree.Service
          const project = yield* Project.Service
          yield* worktree.remove(body)
          yield* project.removeSandbox(Instance.project.id, body.directory)
          return true
        }),
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.ResetInput.zod),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.reset", c, function* () {
          const body = c.req.valid("json")
          const svc = yield* Worktree.Service
          yield* svc.reset(body)
          return true
        }),
    )
    .get(
      "/session",
      describeRoute({
        summary: "List sessions",
        description:
          "Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
        operationId: "experimental.session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.GlobalInfo.zod.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: QueryBoolean.optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          cursor: z.coerce
            .number()
            .optional()
            .meta({ description: "Return sessions updated before this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: QueryBoolean.optional().meta({ description: "Include archived sessions (default false)" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const limit = query.limit ?? 100
        const sessions: Session.GlobalInfo[] = []
        for await (const session of Session.listGlobal({
          directory: query.directory,
          roots: queryBoolean(query.roots),
          start: query.start,
          cursor: query.cursor,
          search: query.search,
          limit: limit + 1,
          archived: queryBoolean(query.archived),
        })) {
          sessions.push(session)
        }
        const hasMore = sessions.length > limit
        const list = hasMore ? sessions.slice(0, limit) : sessions
        if (hasMore && list.length > 0) {
          c.header("x-next-cursor", String(list[list.length - 1].time.updated))
        }
        return c.json(list)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource.zod)),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.resource.list", c, function* () {
          const mcp = yield* MCP.Service
          return yield* mcp.resources()
        }),
    ),
)
