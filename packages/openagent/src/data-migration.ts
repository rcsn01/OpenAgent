import { Context, Effect, Layer } from "effect"
import { Database } from "./storage/db"
import { DataMigrationTable } from "./data-migration.sql"
import * as Log from "@openagent-ai/core/util/log"
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import { MessageTable, PartTable, PiSessionEntryTable, SessionTable } from "./session/session.sql"
import type { SessionID } from "./session/schema"
import { fromOpenAgentMessages } from "./pi/transcript"
import { OpenAgentPiSessionStorage } from "./pi/session-storage"
import type { MessageV2 } from "./session/message-v2"

export type Migration<R = never> = {
  name: string
  run: Effect.Effect<void, unknown, R>
}

const log = Log.create({ service: "data-migration" })

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@openagent/DataMigration") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const migrations: Migration[] = [
      {
        name: "session_usage_from_messages",
        run: Effect.gen(function* () {
          type Usage = {
            cost: number
            tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
          }

          for (let cursor: SessionID | undefined, page = 1; ; page++) {
            const next = yield* Effect.gen(function* () {
              const sessions = yield* Effect.sync(() =>
                Database.use((db) =>
                  db
                    .select({ id: SessionTable.id })
                    .from(SessionTable)
                    .where(cursor ? gt(SessionTable.id, cursor) : undefined)
                    .orderBy(asc(SessionTable.id))
                    .limit(100)
                    .all(),
                ),
              )
              if (sessions.length === 0) return

              yield* Effect.sync(() =>
                Database.transaction((db) => {
                  const usageBySession = new Map<SessionID, Usage>(
                    sessions.map((session) => [
                      session.id,
                      { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
                    ]),
                  )

                  for (const row of db
                    .select({
                      session_id: MessageTable.session_id,
                      cost: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.cost'), 0)), 0)`,
                      tokens_input: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.input'), 0)), 0)`,
                      tokens_output: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.output'), 0)), 0)`,
                      tokens_reasoning: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.reasoning'), 0)), 0)`,
                      tokens_cache_read: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.cache.read'), 0)), 0)`,
                      tokens_cache_write: sql<number>`coalesce(sum(coalesce(json_extract(${MessageTable.data}, '$.tokens.cache.write'), 0)), 0)`,
                    })
                    .from(MessageTable)
                    .where(
                      and(
                        inArray(
                          MessageTable.session_id,
                          sessions.map((session) => session.id),
                        ),
                        sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
                      ),
                    )
                    .groupBy(MessageTable.session_id)
                    .all()) {
                    const current = usageBySession.get(row.session_id)
                    if (!current) continue
                    current.cost = row.cost
                    current.tokens.input = row.tokens_input
                    current.tokens.output = row.tokens_output
                    current.tokens.reasoning = row.tokens_reasoning
                    current.tokens.cache.read = row.tokens_cache_read
                    current.tokens.cache.write = row.tokens_cache_write
                  }

                  for (const [sessionID, value] of usageBySession) {
                    db.update(SessionTable)
                      .set({
                        cost: value.cost,
                        tokens_input: value.tokens.input,
                        tokens_output: value.tokens.output,
                        tokens_reasoning: value.tokens.reasoning,
                        tokens_cache_read: value.tokens.cache.read,
                        tokens_cache_write: value.tokens.cache.write,
                        time_updated: sql`${SessionTable.time_updated}`,
                      })
                      .where(eq(SessionTable.id, sessionID))
                      .run()
                  }
                }),
              )

              return sessions.at(-1)?.id
            }).pipe(
              Effect.withSpan("DataMigration.sessionUsage.page", {
                attributes: {
                  "data_migration.name": "session_usage_from_messages",
                  "data_migration.page": page,
                  "data_migration.cursor": cursor ?? "",
                },
              }),
            )
            if (!next) return
            cursor = next
            yield* Effect.sleep("10 millis")
          }
        }),
      },
      {
        name: "pi_entries_from_openagent_messages",
        run: Effect.gen(function* () {
          for (let cursor: SessionID | undefined, page = 1; ; page++) {
            const next = yield* Effect.gen(function* () {
              const sessions = Database.use((db) =>
                db
                  .select({
                    id: SessionTable.id,
                    directory: SessionTable.directory,
                    path: SessionTable.path,
                    parent_id: SessionTable.parent_id,
                    time_created: SessionTable.time_created,
                  })
                  .from(SessionTable)
                  .where(cursor ? gt(SessionTable.id, cursor) : undefined)
                  .orderBy(asc(SessionTable.id))
                  .limit(25)
                  .all(),
              )
              if (sessions.length === 0) return

              for (const session of sessions) {
                const existing = Database.use((db) =>
                  db
                    .select({ id: PiSessionEntryTable.id })
                    .from(PiSessionEntryTable)
                    .where(eq(PiSessionEntryTable.session_id, session.id))
                    .limit(1)
                    .get(),
                )
                if (existing) continue

                const rows = Database.use((db) =>
                  db
                    .select()
                    .from(MessageTable)
                    .where(eq(MessageTable.session_id, session.id))
                    .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
                    .all(),
                )
                const messages: MessageV2.WithParts[] = rows.map((row) => {
                  const parts = Database.use((db) =>
                    db
                      .select()
                      .from(PartTable)
                      .where(eq(PartTable.message_id, row.id))
                      .orderBy(asc(PartTable.time_created), asc(PartTable.id))
                      .all(),
                  )
                  return {
                    info: { ...row.data, id: row.id, sessionID: row.session_id } as MessageV2.Info,
                    parts: parts.map(
                      (part) =>
                        ({
                          ...part.data,
                          id: part.id,
                          messageID: part.message_id,
                          sessionID: part.session_id,
                        }) as MessageV2.Part,
                    ),
                  }
                })
                const storage = new OpenAgentPiSessionStorage(session.id, {
                  id: session.id,
                  createdAt: new Date(session.time_created).toISOString(),
                  cwd: session.directory,
                  path: session.path ?? session.directory,
                  parentSessionPath: session.parent_id ?? undefined,
                })
                const piSession = OpenAgentPiSessionStorage.session(
                  session.id,
                  yield* Effect.promise(() => storage.getMetadata()),
                )
                for (const message of fromOpenAgentMessages(messages)) {
                  yield* Effect.promise(() => piSession.appendMessage(message))
                }
              }

              return sessions.at(-1)?.id
            }).pipe(
              Effect.withSpan("DataMigration.piEntries.page", {
                attributes: {
                  "data_migration.name": "pi_entries_from_openagent_messages",
                  "data_migration.page": page,
                  "data_migration.cursor": cursor ?? "",
                },
              }),
            )
            if (!next) return
            cursor = next
            yield* Effect.sleep("10 millis")
          }
        }),
      },
    ]

    yield* Effect.gen(function* () {
      if (migrations.length === 0) return

      // Migrations run in a background fiber, so they must be resumable until
      // their completion row is written.
      for (const migration of migrations) {
        const completed = Database.use((db) =>
          db
            .select({ name: DataMigrationTable.name })
            .from(DataMigrationTable)
            .where(eq(DataMigrationTable.name, migration.name))
            .get(),
        )
        if (completed) continue

        log.info("running data migration", { name: migration.name })
        yield* migration.run.pipe(Effect.withSpan("DataMigration", { attributes: { name: migration.name } }))
        Database.use((db) =>
          db
            .insert(DataMigrationTable)
            .values({ name: migration.name, time_completed: Date.now() })
            .onConflictDoNothing()
            .run(),
        )
      }
    }).pipe(
      Effect.tapCause((cause) =>
        Effect.logError("failed to run data migrations").pipe(Effect.annotateLogs("cause", cause)),
      ),
      Effect.ignore,
      Effect.forkScoped,
    )
    return Service.of({})
  }),
)

export const defaultLayer = layer

export * as DataMigration from "./data-migration"
