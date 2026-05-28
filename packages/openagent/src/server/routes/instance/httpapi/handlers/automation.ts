import {
  AutomationInfo,
  AutomationCreatePayload,
  AutomationRun,
  AutomationRunning,
  AutomationRunsQuery,
  AutomationUpdatePayload,
  type AutomationID as AutomationIDSchema,
} from "../groups/automation"
import {
  Automation,
  AutomationID as AutomationIDValue,
  Service as AutomationService,
} from "@/automation/automation"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import * as ApiError from "../errors"

type AutomationID = typeof AutomationIDSchema.Type

const mapAutomationError = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.mapError((error: unknown) => ApiError.notFound(error instanceof Error ? error.message : String(error))),
    Effect.catchDefect((defect: unknown) =>
      Effect.fail(ApiError.notFound(defect instanceof Error ? defect.message : String(defect))),
    ),
  )

const decodeInfo = (value: unknown) => Schema.decodeUnknownEffect(AutomationInfo)(value).pipe(Effect.orDie)
const decodeRun = (value: unknown) => Schema.decodeUnknownEffect(AutomationRun)(value).pipe(Effect.orDie)
const decodeRunning = (value: unknown) => Schema.decodeUnknownEffect(AutomationRunning)(value).pipe(Effect.orDie)

export const automationHandlers = HttpApiBuilder.group(InstanceHttpApi, "automation", (handlers) =>
  Effect.gen(function* () {
    const automation = yield* AutomationService

    const list = Effect.fn("AutomationHttpApi.list")(function* () {
      return yield* Schema.decodeUnknownEffect(Schema.Array(AutomationInfo))(yield* automation.list()).pipe(Effect.orDie)
    })

    const create = Effect.fn("AutomationHttpApi.create")(function* (ctx: {
      payload: typeof AutomationCreatePayload.Type
    }) {
      return yield* decodeInfo(yield* automation.create(ctx.payload as Automation.CreateInput))
    })

    const running = Effect.fn("AutomationHttpApi.running")(function* () {
      const count = yield* automation.running()
      return yield* decodeRunning({ running: count > 0, count })
    })

    const update = Effect.fn("AutomationHttpApi.update")(function* (ctx: {
      params: { automationID: AutomationID }
      payload: typeof AutomationUpdatePayload.Type
    }) {
      const result = yield* mapAutomationError(
        automation.update({
          automationID: AutomationIDValue.parse(ctx.params.automationID),
          ...(ctx.payload as Automation.UpdateInput),
        }),
      )
      return yield* decodeInfo(result)
    })

    const delete_ = Effect.fn("AutomationHttpApi.delete")(function* (ctx: { params: { automationID: AutomationID } }) {
      return yield* mapAutomationError(automation.remove(AutomationIDValue.parse(ctx.params.automationID)))
    })

    const run = Effect.fn("AutomationHttpApi.run")(function* (ctx: { params: { automationID: AutomationID } }) {
      return yield* decodeRun(yield* mapAutomationError(automation.runNow(AutomationIDValue.parse(ctx.params.automationID))))
    })

    const runs = Effect.fn("AutomationHttpApi.runs")(function* (ctx: {
      params: { automationID: AutomationID }
      query: typeof AutomationRunsQuery.Type
    }) {
      const result = yield* mapAutomationError(
        automation.runs({
          automationID: AutomationIDValue.parse(ctx.params.automationID),
          limit: ctx.query.limit,
        }),
      )
      return yield* Schema.decodeUnknownEffect(Schema.Array(AutomationRun))(result).pipe(Effect.orDie)
    })

    return handlers
      .handle("list", list)
      .handle("create", create)
      .handle("running", running)
      .handle("update", update)
      .handle("delete", delete_)
      .handle("run", run)
      .handle("runs", runs)
  }),
)
