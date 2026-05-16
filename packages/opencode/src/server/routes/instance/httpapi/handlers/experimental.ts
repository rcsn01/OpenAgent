import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Extension } from "@/extension"
import { ConfigPlugin } from "@/config/plugin"
import { InstanceState } from "@/effect/instance-state"
import { Filesystem } from "@/util/filesystem"
import { MCP } from "@/mcp"
import { installPlugin, patchPluginConfig, readPluginManifest, setPluginEnabledInFile } from "@/plugin/install"
import { parsePluginSpecifier, pluginSource, resolvePathPluginTarget } from "@/plugin/shared"
import { Project } from "@/project/project"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Effect, Option } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import npa from "npm-package-arg"
import path from "path"
import { InstanceHttpApi } from "../api"
import {
  ConsoleSwitchPayload,
  ExperimentalExtensionRemovePayload,
  ExperimentalPluginInstallPayload,
  ExperimentalPluginStatePayload,
  SessionListQuery,
  ToolListQuery,
  WorktreeApiError,
} from "../groups/experimental"

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

const pluginError = Effect.fn("ExperimentalHttpApi.pluginError")(function* (
  result:
    | Exclude<Awaited<ReturnType<typeof readPluginManifest>>, { ok: true }>
    | Exclude<Awaited<ReturnType<typeof setPluginEnabledInFile>>, { ok: true }>
    | Exclude<Awaited<ReturnType<typeof patchPluginConfig>>, { ok: true }>,
) {
  yield* Effect.logDebug("plugin request failed", { code: result.code })
  return yield* Effect.fail(new HttpApiError.BadRequest({}))
})

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const extension = yield* Extension.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const plugins = Effect.fn("ExperimentalHttpApi.plugins")(function* () {
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
    })

    const pluginsInstall = Effect.fn("ExperimentalHttpApi.pluginsInstall")(function* (ctx: {
      payload: typeof ExperimentalPluginInstallPayload.Type
    }) {
      const config = yield* Config.Service
      const target = yield* Effect.promise(() => installPlugin(ctx.payload.spec))
      if (!target.ok) return yield* Effect.fail(new HttpApiError.BadRequest({}))

      const manifest = yield* Effect.promise(() => readPluginManifest(target.target))
      if (!manifest.ok) return yield* pluginError(manifest)

      const serverTargets = manifest.targets.filter((item) => item.kind === "server")
      if (!serverTargets.length) return yield* Effect.fail(new HttpApiError.BadRequest({}))

      const patched = yield* Effect.promise(() =>
        patchPluginConfig({
          spec: ctx.payload.spec,
          targets: serverTargets,
          force: ctx.payload.force,
          global: ctx.payload.global,
          vcs: Instance.project.vcs,
          worktree: Instance.worktree,
          directory: Instance.directory,
          config: Global.Path.config,
        }),
      )
      if (!patched.ok) return yield* pluginError(patched)

      yield* config.invalidate(true)
      return true
    })

    const pluginsEnable = Effect.fn("ExperimentalHttpApi.pluginsEnable")(function* (ctx: {
      payload: typeof ExperimentalPluginStatePayload.Type
    }) {
      const config = yield* Config.Service
      const current = yield* config.get()
      const hit = (current.plugin_origins ?? []).find(
        (item) => item.source === ctx.payload.source && ConfigPlugin.pluginSpecifier(item.spec) === ctx.payload.spec,
      )
      if (!hit || !editablePluginSource(hit.source)) return yield* Effect.fail(new HttpApiError.BadRequest({}))

      const result = yield* Effect.promise(() =>
        setPluginEnabledInFile({
          file: hit.source,
          spec: ctx.payload.spec,
          enabled: true,
        }),
      )
      if (!result.ok) return yield* pluginError(result)

      yield* config.invalidate(true)
      return true
    })

    const pluginsDisable = Effect.fn("ExperimentalHttpApi.pluginsDisable")(function* (ctx: {
      payload: typeof ExperimentalPluginStatePayload.Type
    }) {
      const config = yield* Config.Service
      const current = yield* config.get()
      const hit = (current.plugin_origins ?? []).find(
        (item) => item.source === ctx.payload.source && ConfigPlugin.pluginSpecifier(item.spec) === ctx.payload.spec,
      )
      if (!hit || !editablePluginSource(hit.source)) return yield* Effect.fail(new HttpApiError.BadRequest({}))

      const result = yield* Effect.promise(() =>
        setPluginEnabledInFile({
          file: hit.source,
          spec: ctx.payload.spec,
          enabled: false,
        }),
      )
      if (!result.ok) return yield* pluginError(result)

      yield* config.invalidate(true)
      return true
    })

    const extensions = Effect.fn("ExperimentalHttpApi.extensions")(function* () {
      return yield* extension.list()
    })

    const extensionsInstall = Effect.fn("ExperimentalHttpApi.extensionsInstall")(function* (ctx: {
      payload: typeof Extension.ExtensionBundle.Type
    }) {
      yield* extension.install(ctx.payload)
      return true
    })

    const extensionsRemove = Effect.fn("ExperimentalHttpApi.extensionsRemove")(function* (ctx: {
      payload: typeof ExperimentalExtensionRemovePayload.Type
    }) {
      yield* extension.remove(ctx.payload.id)
      return true
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: Worktree.CreateInput | undefined
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const sessions = Array.from(
        Session.listGlobal({
          directory: ctx.query.directory,
          roots: ctx.query.roots,
          start: ctx.query.start,
          cursor: ctx.query.cursor,
          search: ctx.query.search,
          limit: limit + 1,
          archived: ctx.query.archived,
        }),
      )
      const list = sessions.length > limit ? sessions.slice(0, limit) : sessions
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          sessions.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    return handlers
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("plugins", plugins)
      .handle("pluginsInstall", pluginsInstall)
      .handle("pluginsEnable", pluginsEnable)
      .handle("pluginsDisable", pluginsDisable)
      .handle("extensions", extensions)
      .handle("extensionsInstall", extensionsInstall)
      .handle("extensionsRemove", extensionsRemove)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("resource", resource)
  }),
)
