import { ModelID, ProviderID } from "@/provider/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

export const AutomationID = Schema.String.check(Schema.isStartsWith("atm_")).pipe(Schema.brand("AutomationID"))
export const AutomationRunID = Schema.String.check(Schema.isStartsWith("atr_")).pipe(Schema.brand("AutomationRunID"))

export const AutomationModel = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
})

export const AutomationSchedule = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("interval"),
    minutes: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("daily"),
    time: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("weekday"),
    time: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("weekly"),
    day: Schema.Number,
    time: Schema.String,
  }),
])

export const AutomationStatus = Schema.Literals(["active", "paused"])
export const AutomationRunStatus = Schema.Literals(["running", "succeeded", "failed", "cancelled"])

export const AutomationInfo = Schema.Struct({
  id: AutomationID,
  projectID: Schema.optional(Schema.String),
  directory: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  schedule: AutomationSchedule,
  status: AutomationStatus,
  model: Schema.optional(AutomationModel),
  variant: Schema.optional(Schema.String),
  nextRunAt: Schema.Number,
  lastRunAt: Schema.optional(Schema.Number),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "Automation" })

export const AutomationRun = Schema.Struct({
  id: AutomationRunID,
  automationID: AutomationID,
  directory: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  status: AutomationRunStatus,
  error: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "AutomationRun" })

export const AutomationRunning = Schema.Struct({
  running: Schema.Boolean,
  count: Schema.Number,
}).annotate({ identifier: "AutomationRunning" })

export const AutomationCreatePayload = Schema.Struct({
  directory: Schema.optional(Schema.String),
  name: Schema.String,
  prompt: Schema.String,
  schedule: AutomationSchedule,
  status: Schema.optional(AutomationStatus),
  model: Schema.optional(AutomationModel),
  variant: Schema.optional(Schema.NullOr(Schema.String)),
})

export const AutomationUpdatePayload = Schema.Struct({
  directory: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  schedule: Schema.optional(AutomationSchedule),
  status: Schema.optional(AutomationStatus),
  model: Schema.optional(Schema.NullOr(AutomationModel)),
  variant: Schema.optional(Schema.NullOr(Schema.String)),
})

export const AutomationRunsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString),
})

export const AutomationPaths = {
  root: "/automation",
  running: "/automation/running",
  byID: "/automation/:automationID",
  run: "/automation/:automationID/run",
  runs: "/automation/:automationID/runs",
} as const

export const AutomationApi = HttpApi.make("automation")
  .add(
    HttpApiGroup.make("automation")
      .add(
        HttpApiEndpoint.get("list", AutomationPaths.root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(AutomationInfo), "List of automations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.list",
            summary: "List automations",
            description: "List recurring local automations.",
          }),
        ),
        HttpApiEndpoint.post("create", AutomationPaths.root, {
          query: WorkspaceRoutingQuery,
          payload: AutomationCreatePayload,
          success: described(AutomationInfo, "Created automation"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.create",
            summary: "Create automation",
            description: "Create a recurring local automation.",
          }),
        ),
        HttpApiEndpoint.get("running", AutomationPaths.running, {
          query: WorkspaceRoutingQuery,
          success: described(AutomationRunning, "Automation running status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.running",
            summary: "Get automation running status",
            description: "Return whether any automation runs are currently active.",
          }),
        ),
        HttpApiEndpoint.patch("update", AutomationPaths.byID, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          payload: AutomationUpdatePayload,
          success: described(AutomationInfo, "Updated automation"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.update",
            summary: "Update automation",
            description: "Update an existing automation.",
          }),
        ),
        HttpApiEndpoint.delete("delete", AutomationPaths.byID, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Automation deleted"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.delete",
            summary: "Delete automation",
            description: "Delete an automation and its run history.",
          }),
        ),
        HttpApiEndpoint.post("run", AutomationPaths.run, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          success: described(AutomationRun, "Automation run"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run",
            summary: "Run automation now",
            description: "Run an automation immediately and return the run record.",
          }),
        ),
        HttpApiEndpoint.get("runs", AutomationPaths.runs, {
          params: { automationID: AutomationID },
          query: AutomationRunsQuery,
          success: described(Schema.Array(AutomationRun), "Automation runs"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.runs",
            summary: "List automation runs",
            description: "List recent run records for an automation.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "automation",
          description: "Automation routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
