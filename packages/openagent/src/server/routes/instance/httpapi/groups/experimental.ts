import { AccountID, OrgID } from "@/account/schema"
import { Extension } from "@/extension"
import { MCP } from "@/mcp"
import { ProviderID, ModelID } from "@/provider/schema"
import { Session } from "@/session/session"
import { Worktree } from "@/worktree"
import { NonNegativeInt } from "@openagent-ai/core/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { QueryBoolean } from "./query"

const ConsoleStateResponse = Schema.Struct({
  consoleManagedProviders: Schema.mutable(Schema.Array(Schema.String)),
  activeOrgName: Schema.optionalKey(Schema.String),
  switchableOrgCount: NonNegativeInt,
}).annotate({ identifier: "ConsoleState" })

const ConsoleOrgOption = Schema.Struct({
  accountID: Schema.String,
  accountEmail: Schema.String,
  accountUrl: Schema.String,
  orgID: Schema.String,
  orgName: Schema.String,
  active: Schema.Boolean,
})

const ConsoleOrgList = Schema.Struct({
  orgs: Schema.Array(ConsoleOrgOption),
})

export const ConsoleSwitchPayload = Schema.Struct({
  accountID: AccountID,
  orgID: OrgID,
})

const ToolIDs = Schema.Array(Schema.String).annotate({ identifier: "ToolIDs" })
const ToolListItem = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  parameters: Schema.Unknown,
}).annotate({ identifier: "ToolListItem" })
const ToolList = Schema.Array(ToolListItem).annotate({ identifier: "ToolList" })
export const ToolListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  provider: ProviderID,
  model: ModelID,
})
const PluginTargetKind = Schema.Literals(["server", "tui"])
const ExperimentalPlugin = Schema.Struct({
  spec: Schema.String,
  packageName: Schema.String,
  version: Schema.optional(Schema.String),
  source: Schema.String,
  scope: Schema.Literals(["global", "local"]),
  kind: Schema.Literals(["file", "npm"]),
  enabled: Schema.Boolean,
  editable: Schema.Boolean,
  installed: Schema.Boolean,
  target: Schema.optional(Schema.String),
  targets: Schema.Array(PluginTargetKind),
}).annotate({ identifier: "ExperimentalPlugin" })
const ExperimentalPluginList = Schema.Struct({
  plugins: Schema.Array(ExperimentalPlugin),
}).annotate({ identifier: "ExperimentalPluginList" })
export const ExperimentalPluginInstallPayload = Schema.Struct({
  spec: Schema.String,
  global: Schema.optional(Schema.Boolean),
  force: Schema.optional(Schema.Boolean),
})
export const ExperimentalPluginStatePayload = Schema.Struct({
  spec: Schema.String,
  source: Schema.String,
})
export const ExperimentalExtensionRemovePayload = Schema.Struct({
  id: Schema.String,
})

const WorktreeList = Schema.Array(Schema.String)
const WorktreeErrorName = Schema.Union([
  Schema.Literal("WorktreeNotGitError"),
  Schema.Literal("WorktreeNameGenerationFailedError"),
  Schema.Literal("WorktreeCreateFailedError"),
  Schema.Literal("WorktreeStartCommandFailedError"),
  Schema.Literal("WorktreeRemoveFailedError"),
  Schema.Literal("WorktreeResetFailedError"),
  Schema.Literal("WorktreeListFailedError"),
])
export class WorktreeApiError extends Schema.ErrorClass<WorktreeApiError>("WorktreeError")(
  {
    name: WorktreeErrorName,
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}
export const SessionListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  archived: Schema.optional(QueryBoolean),
})

export const ExperimentalPaths = {
  console: "/experimental/console",
  consoleOrgs: "/experimental/console/orgs",
  consoleSwitch: "/experimental/console/switch",
  plugins: "/experimental/plugins",
  pluginsInstall: "/experimental/plugins/install",
  pluginsEnable: "/experimental/plugins/enable",
  pluginsDisable: "/experimental/plugins/disable",
  extensions: "/experimental/extensions",
  extensionsInstall: "/experimental/extensions/install",
  extensionsRemove: "/experimental/extensions/remove",
  tool: "/experimental/tool",
  toolIDs: "/experimental/tool/ids",
  worktree: "/experimental/worktree",
  worktreeReset: "/experimental/worktree/reset",
  session: "/experimental/session",
  resource: "/experimental/resource",
} as const

export const ExperimentalApi = HttpApi.make("experimental")
  .add(
    HttpApiGroup.make("experimental")
      .add(
        HttpApiEndpoint.get("console", ExperimentalPaths.console, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleStateResponse, "Active Console provider metadata"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.get",
            summary: "Get active Console provider metadata",
            description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
          }),
        ),
        HttpApiEndpoint.get("consoleOrgs", ExperimentalPaths.consoleOrgs, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleOrgList, "Switchable Console orgs"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.listOrgs",
            summary: "List switchable Console orgs",
            description: "Get the available Console orgs across logged-in accounts, including the current active org.",
          }),
        ),
        HttpApiEndpoint.post("consoleSwitch", ExperimentalPaths.consoleSwitch, {
          query: WorkspaceRoutingQuery,
          payload: ConsoleSwitchPayload,
          success: described(Schema.Boolean, "Switch success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.switchOrg",
            summary: "Switch active Console org",
            description: "Persist a new active Console account/org selection for the current local OpenAgent state.",
          }),
        ),
        HttpApiEndpoint.get("plugins", ExperimentalPaths.plugins, {
          success: described(ExperimentalPluginList, "Configured plugins"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.plugins.list",
            summary: "List configured plugins",
            description:
              "Get configured GUI-manageable plugin metadata, including source, scope, targets, and enabled state.",
          }),
        ),
        HttpApiEndpoint.post("pluginsInstall", ExperimentalPaths.pluginsInstall, {
          payload: ExperimentalPluginInstallPayload,
          success: described(Schema.Boolean, "Install success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.plugins.install",
            summary: "Install and configure a plugin",
            description: "Install a plugin package and update shared server plugin config for the current instance.",
          }),
        ),
        HttpApiEndpoint.post("pluginsEnable", ExperimentalPaths.pluginsEnable, {
          payload: ExperimentalPluginStatePayload,
          success: described(Schema.Boolean, "Enable success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.plugins.enable",
            summary: "Enable a configured plugin",
            description: "Enable a plugin entry in its source config file.",
          }),
        ),
        HttpApiEndpoint.post("pluginsDisable", ExperimentalPaths.pluginsDisable, {
          payload: ExperimentalPluginStatePayload,
          success: described(Schema.Boolean, "Disable success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.plugins.disable",
            summary: "Disable a configured plugin",
            description: "Disable a plugin entry in its source config file.",
          }),
        ),
        HttpApiEndpoint.get("extensions", ExperimentalPaths.extensions, {
          success: described(Extension.ExtensionList, "Installed extensions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.extensions.list",
            summary: "List installed extensions",
            description:
              "Get project-scoped managed extension state, including managed MCP servers, tool definitions, and managed skills.",
          }),
        ),
        HttpApiEndpoint.post("extensionsInstall", ExperimentalPaths.extensionsInstall, {
          payload: Extension.ExtensionBundle,
          success: described(Schema.Boolean, "Install success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.extensions.install",
            summary: "Install an extension bundle",
            description: "Install or reinstall a project-scoped extension bundle into the current instance.",
          }),
        ),
        HttpApiEndpoint.post("extensionsRemove", ExperimentalPaths.extensionsRemove, {
          payload: ExperimentalExtensionRemovePayload,
          success: described(Schema.Boolean, "Remove success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.extensions.remove",
            summary: "Remove an installed extension",
            description: "Remove a project-scoped managed extension and its owned MCP config and skills.",
          }),
        ),
        HttpApiEndpoint.get("tool", ExperimentalPaths.tool, {
          query: ToolListQuery,
          success: described(ToolList, "Tools"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.list",
            summary: "List tools",
            description:
              "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
          }),
        ),
        HttpApiEndpoint.get("toolIDs", ExperimentalPaths.toolIDs, {
          query: WorkspaceRoutingQuery,
          success: described(ToolIDs, "Tool IDs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.ids",
            summary: "List tool IDs",
            description:
              "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
          }),
        ),
        HttpApiEndpoint.get("worktree", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          success: described(WorktreeList, "List of worktree directories"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.list",
            summary: "List worktrees",
            description: "List all sandbox worktrees for the current project.",
          }),
        ),
        HttpApiEndpoint.post("worktreeCreate", ExperimentalPaths.worktree, {
          disableCodecs: true,
          query: WorkspaceRoutingQuery,
          payload: Schema.UndefinedOr(Worktree.CreateInput),
          success: described(Worktree.Info, "Worktree created"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.create",
            summary: "Create worktree",
            description: "Create a new git worktree for the current project and run any configured startup scripts.",
          }),
        ),
        HttpApiEndpoint.delete("worktreeRemove", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.RemoveInput,
          success: described(Schema.Boolean, "Worktree removed"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.remove",
            summary: "Remove worktree",
            description: "Remove a git worktree and delete its branch.",
          }),
        ),
        HttpApiEndpoint.post("worktreeReset", ExperimentalPaths.worktreeReset, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.ResetInput,
          success: described(Schema.Boolean, "Worktree reset"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.reset",
            summary: "Reset worktree",
            description: "Reset a worktree branch to the primary default branch.",
          }),
        ),
        HttpApiEndpoint.get("session", ExperimentalPaths.session, {
          query: SessionListQuery,
          success: described(Schema.Array(Session.GlobalInfo), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.list",
            summary: "List sessions",
            description:
              "Get a list of all OpenAgent sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
          }),
        ),
        HttpApiEndpoint.get("resource", ExperimentalPaths.resource, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Record(Schema.String, MCP.Resource), "MCP resources"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.resource.list",
            summary: "Get MCP resources",
            description: "Get all available MCP resources from connected servers. Optionally filter by name.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "experimental",
          description: "Experimental HttpApi instance routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "OpenAgent experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
