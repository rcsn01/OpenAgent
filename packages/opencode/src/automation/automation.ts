import z from "zod"
import { and, asc, desc, eq, lte } from "drizzle-orm"
import { Effect, Context, Layer, Schedule, Duration, Scope, Cause } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { ascending } from "@/id/id"
import { Database } from "@/storage/db"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { AutomationRunTable, AutomationTable } from "./automation.sql"
import { SessionID } from "@/session/schema"
import { ProjectID } from "@/project/schema"

const log = Log.create({ service: "automation" })

export const AutomationID = z.string().startsWith("atm_").transform((x) => x as AutomationID)
export type AutomationID = string & { readonly __brand: "AutomationID" }

export const AutomationRunID = z.string().startsWith("atr_").transform((x) => x as AutomationRunID)
export type AutomationRunID = string & { readonly __brand: "AutomationRunID" }

const DailySchedule = z.object({
  type: z.literal("daily"),
  time: z.string().regex(/^\d{2}:\d{2}$/),
})

const WeeklySchedule = z.object({
  type: z.literal("weekly"),
  day: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/),
})

const IntervalSchedule = z.object({
  type: z.literal("interval"),
  minutes: z.number().int().min(15).max(60 * 24 * 30),
})

const ScheduleSchema = z.discriminatedUnion("type", [DailySchedule, WeeklySchedule, IntervalSchedule])
const StatusSchema = z.enum(["active", "paused"])
const RunStatusSchema = z.enum(["running", "succeeded", "failed", "cancelled"])

export namespace Automation {
  export type Schedule = z.infer<typeof ScheduleSchema>
  export type Status = z.infer<typeof StatusSchema>
  export type RunStatus = z.infer<typeof RunStatusSchema>

  export const Info = z.object({
    id: AutomationID,
    projectID: ProjectID.zod,
    directory: z.string(),
    name: z.string(),
    prompt: z.string(),
    schedule: ScheduleSchema,
    status: StatusSchema,
    nextRunAt: z.number(),
    lastRunAt: z.number().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const Run = z.object({
    id: AutomationRunID,
    automationID: AutomationID,
    sessionID: SessionID.zod.optional(),
    status: RunStatusSchema,
    error: z.string().optional(),
    startedAt: z.number(),
    completedAt: z.number().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Run = z.infer<typeof Run>

  export const CreateInput = z.object({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1),
    schedule: ScheduleSchema,
    status: StatusSchema.default("active"),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().trim().min(1).optional(),
    schedule: ScheduleSchema.optional(),
    status: StatusSchema.optional(),
  })
  export type UpdateInput = z.infer<typeof UpdateInput>
}

type AutomationRow = typeof AutomationTable.$inferSelect
type RunRow = typeof AutomationRunTable.$inferSelect

function toInfo(row: AutomationRow): Automation.Info {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: row.directory,
    name: row.name,
    prompt: row.prompt,
    schedule: row.schedule,
    status: row.status,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function toRun(row: RunRow): Automation.Run {
  return {
    id: row.id,
    automationID: row.automation_id,
    sessionID: row.session_id ?? undefined,
    status: row.status,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function parseClock(time: string) {
  const [h, m] = time.split(":").map(Number)
  return { hour: h ?? 0, minute: m ?? 0 }
}

export function nextRunAt(schedule: Automation.Schedule, from = Date.now()) {
  if (schedule.type === "interval") return from + schedule.minutes * 60_000

  const start = new Date(from)
  const { hour, minute } = parseClock(schedule.time)
  const next = new Date(start)
  next.setSeconds(0, 0)
  next.setHours(hour, minute, 0, 0)

  if (schedule.type === "daily") {
    if (next.getTime() <= from) next.setDate(next.getDate() + 1)
    return next.getTime()
  }

  const delta = (schedule.day - next.getDay() + 7) % 7
  next.setDate(next.getDate() + delta)
  if (next.getTime() <= from) next.setDate(next.getDate() + 7)
  return next.getTime()
}

export interface Interface {
  readonly list: (input?: { directory?: string }) => Effect.Effect<Automation.Info[]>
  readonly create: (input: Automation.CreateInput) => Effect.Effect<Automation.Info>
  readonly update: (input: { automationID: AutomationID } & Automation.UpdateInput) => Effect.Effect<Automation.Info>
  readonly remove: (automationID: AutomationID) => Effect.Effect<boolean>
  readonly runs: (input: { automationID: AutomationID; limit?: number }) => Effect.Effect<Automation.Run[]>
  readonly runNow: (automationID: AutomationID) => Effect.Effect<Automation.Run>
  readonly runDue: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Automation") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const projects = yield* Project.Service
    const sessionSvc = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const scope = yield* Scope.Scope

    const get = Effect.fn("Automation.get")(function* (automationID: AutomationID) {
      const row = Database.use((db) => db.select().from(AutomationTable).where(eq(AutomationTable.id, automationID)).get())
      if (!row) throw new Error(`Automation not found: ${automationID}`)
      return toInfo(row)
    })

    const list: Interface["list"] = Effect.fn("Automation.list")(function* (input) {
      const directory = input?.directory ?? (yield* InstanceState.context).directory
      const rows = Database.use((db) => {
        return db
          .select()
          .from(AutomationTable)
          .where(eq(AutomationTable.directory, directory))
          .orderBy(asc(AutomationTable.name))
          .all()
      })
      return rows.map(toInfo)
    })

    const create: Interface["create"] = Effect.fn("Automation.create")(function* (input) {
      const ctx = yield* InstanceState.context
      const now = Date.now()
      const value = {
        id: ascending("automation") as AutomationID,
        project_id: ctx.project.id,
        directory: ctx.directory,
        name: input.name,
        prompt: input.prompt,
        schedule: input.schedule,
        status: input.status,
        next_run_at: nextRunAt(input.schedule, now),
        time_created: now,
        time_updated: now,
      } satisfies typeof AutomationTable.$inferInsert
      Database.use((db) => db.insert(AutomationTable).values(value).run())
      return yield* get(value.id)
    })

    const update: Interface["update"] = Effect.fn("Automation.update")(function* (input) {
      const current = yield* get(input.automationID)
      const nextSchedule = input.schedule ?? current.schedule
      Database.use((db) =>
        db
          .update(AutomationTable)
          .set({
            name: input.name,
            prompt: input.prompt,
            schedule: input.schedule,
            status: input.status,
            next_run_at: input.schedule ? nextRunAt(nextSchedule) : undefined,
            time_updated: Date.now(),
          })
          .where(eq(AutomationTable.id, input.automationID))
          .run(),
      )
      return yield* get(input.automationID)
    })

    const remove: Interface["remove"] = Effect.fn("Automation.remove")(function* (automationID) {
      Database.use((db) => db.delete(AutomationTable).where(eq(AutomationTable.id, automationID)).run())
      return true
    })

    const runs: Interface["runs"] = Effect.fn("Automation.runs")(function* (input) {
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationRunTable)
          .where(eq(AutomationRunTable.automation_id, input.automationID))
          .orderBy(desc(AutomationRunTable.started_at))
          .limit(input.limit ?? 20)
          .all(),
      )
      return rows.map(toRun)
    })

    const hasRunning = (automationID: AutomationID) =>
      Database.use((db) =>
        db
          .select({ id: AutomationRunTable.id })
          .from(AutomationRunTable)
          .where(and(eq(AutomationRunTable.automation_id, automationID), eq(AutomationRunTable.status, "running")))
          .get(),
      )

    const execute = Effect.fn("Automation.execute")(function* (automation: Automation.Info) {
      const existing = hasRunning(automation.id)
      if (existing) return yield* runs({ automationID: automation.id, limit: 1 }).pipe(Effect.map((items) => items[0]!))

      const now = Date.now()
      const runID = ascending("automation_run") as AutomationRunID
      Database.use((db) =>
        db
          .insert(AutomationRunTable)
          .values({
            id: runID,
            automation_id: automation.id,
            status: "running",
            started_at: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )

      const finalize = (patch: Partial<typeof AutomationRunTable.$inferInsert>) =>
        Database.use((db) =>
          db
            .update(AutomationRunTable)
            .set({ ...patch, completed_at: Date.now(), time_updated: Date.now() })
            .where(eq(AutomationRunTable.id, runID))
            .run(),
        )

      const context = yield* projects.fromDirectory(automation.directory)
      const instance = {
        directory: automation.directory,
        worktree: context.sandbox,
        project: context.project,
      }

      yield* Effect.gen(function* () {
        const session = yield* sessionSvc.create({
          title: `[Automation] ${automation.name} - ${new Date().toLocaleString()}`,
        })
        Database.use((db) =>
          db
            .update(AutomationRunTable)
            .set({ session_id: session.id, time_updated: Date.now() })
            .where(eq(AutomationRunTable.id, runID))
            .run(),
        )
        yield* promptSvc
          .prompt({
            sessionID: session.id,
            parts: [{ type: "text", text: automation.prompt }],
          })
          .pipe(
            Effect.tap(() => Effect.sync(() => finalize({ status: "succeeded" }))),
            Effect.catchCause((cause) => Effect.sync(() => finalize({ status: "failed", error: Cause.pretty(cause) }))),
            Effect.forkIn(scope, { startImmediately: true }),
          )
        return session.id
      }).pipe(
        Effect.provideService(InstanceRef, instance),
        Effect.tap((sessionID) =>
          Effect.sync(() => {
            Database.use((db) =>
              db
                .update(AutomationRunTable)
                .set({ session_id: sessionID, time_updated: Date.now() })
                .where(eq(AutomationRunTable.id, runID))
                .run(),
            )
          }),
        ),
        Effect.catchCause((cause) => Effect.sync(() => finalize({ status: "failed", error: Cause.pretty(cause) }))),
      )

      const completed = yield* runs({ automationID: automation.id, limit: 1 })
      return completed[0]!
    })

    const runNow: Interface["runNow"] = Effect.fn("Automation.runNow")(function* (automationID) {
      const automation = yield* get(automationID)
      const run = yield* execute(automation)
      Database.use((db) =>
        db
          .update(AutomationTable)
          .set({
            last_run_at: run.startedAt,
            next_run_at: nextRunAt(automation.schedule),
            time_updated: Date.now(),
          })
          .where(eq(AutomationTable.id, automation.id))
          .run(),
      )
      return run
    })

    const runDue: Interface["runDue"] = Effect.fn("Automation.runDue")(function* () {
      const now = Date.now()
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationTable)
          .where(and(eq(AutomationTable.status, "active"), lte(AutomationTable.next_run_at, now)))
          .orderBy(asc(AutomationTable.next_run_at))
          .limit(10)
          .all(),
      )
      for (const row of rows) {
        const automation = toInfo(row)
        yield* runNow(automation.id).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log.error("scheduled automation failed", { automationID: automation.id, cause })),
          ),
        )
      }
    })

    yield* runDue().pipe(
      Effect.catchCause((cause) => Effect.sync(() => log.error("automation startup run failed", { cause }))),
      Effect.repeat(Schedule.spaced(Duration.minutes(1))),
      Effect.forkScoped,
    )

    return Service.of({ list, create, update, remove, runs, runNow, runDue })
  }),
)

export const defaultLayer = layer
