import { and, desc, eq, isNull } from "drizzle-orm"
import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { InstanceRef } from "@/effect/instance-ref"
import { which } from "@/util/which"
import { serviceUse } from "@/effect/service-use"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Effect, Layer, Path, Context, Schema, Stream, Types } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { NodePath } from "@effect/platform-node"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { GeneralChatTable } from "./general-chat.sql"
import { chatsRoot } from "./shared"

type Row = typeof GeneralChatTable.$inferSelect
type GitResult = { code: number; text: string; stderr: string }

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

export const Info = Schema.Struct({
  session: Session.Info,
  rootSessionID: SessionID,
  directory: Schema.String,
})
  .annotate({ identifier: "GeneralChat" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly create: () => Effect.Effect<Info>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly delete: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GeneralChat") {}

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Session.Service | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const pathSvc = yield* Path.Path
    const sessions = yield* Session.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const git = Effect.fnUntraced(
      function* (args: string[], cwd: string) {
        const handle = yield* spawner.spawn(
          ChildProcess.make("git", args, { cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code, text, stderr } satisfies GitResult
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
    )

    const ensureGlobalProject = Effect.fn("GeneralChat.ensureGlobalProject")(function* () {
      yield* db((d) =>
        d
          .insert(ProjectTable)
          .values({
            id: ProjectID.global,
            worktree: "/",
            vcs: null,
            name: null,
            icon_url: null,
            icon_url_override: null,
            icon_color: null,
            time_created: Date.now(),
            time_updated: Date.now(),
            time_initialized: null,
            sandboxes: [],
            commands: null,
          })
          .onConflictDoNothing({ target: ProjectTable.id })
          .run(),
      )
    })

    const tryInitGit = Effect.fn("GeneralChat.tryInitGit")(function* (directory: string) {
      if (!(yield* Effect.sync(() => which("git")))) return false
      const result = yield* git(["init", "--quiet"], directory)
      return result.code === 0
    })

    const allocateDirectory = Effect.fn("GeneralChat.allocateDirectory")(function* () {
      yield* fs.ensureDir(chatsRoot).pipe(Effect.orDie)
      const directory = pathSvc.join(
        chatsRoot,
        `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      )
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      return directory
    })

    const buildInfo = (row: Row, session: Session.Info): Info => ({
      session,
      rootSessionID: row.session_id,
      directory: row.directory,
    })

    const resolveRoot = Effect.fn("GeneralChat.resolveRoot")(function* (sessionID: SessionID) {
      let current = yield* sessions.get(sessionID)
      while (current.parentID) {
        current = yield* sessions.get(current.parentID)
      }
      return current
    })

    const getRow = Effect.fn("GeneralChat.getRow")(function* (rootSessionID: SessionID) {
      const row = yield* db((d) =>
        d.select().from(GeneralChatTable).where(eq(GeneralChatTable.session_id, rootSessionID)).get(),
      )
      if (!row) throw new NotFoundError({ message: `General chat not found: ${rootSessionID}` })
      return row
    })

    const list = Effect.fn("GeneralChat.list")(function* () {
      const rows = yield* db((d) =>
        d
          .select({ chat: GeneralChatTable, session: SessionTable })
          .from(GeneralChatTable)
          .innerJoin(SessionTable, eq(GeneralChatTable.session_id, SessionTable.id))
          .where(and(isNull(SessionTable.parent_id), isNull(SessionTable.time_archived)))
          .orderBy(desc(SessionTable.time_updated))
          .all(),
      )
      return rows.map((row) => buildInfo(row.chat, Session.fromRow(row.session)))
    })

    const create = Effect.fn("GeneralChat.create")(function* () {
      const directory = yield* allocateDirectory()
      const vcs = (yield* tryInitGit(directory)) ? ("git" as const) : undefined
      const now = Date.now()
      yield* ensureGlobalProject()
      const session = yield* sessions.create().pipe(
        Effect.provideService(InstanceRef, {
          directory,
          worktree: directory,
          project: {
            id: ProjectID.global,
            worktree: directory,
            vcs,
            sandboxes: [],
            time: { created: now, updated: now },
          },
        }),
      )
      const row = yield* db((d) =>
        d
          .insert(GeneralChatTable)
          .values({
            session_id: session.id,
            directory,
          })
          .returning()
          .get(),
      )
      if (!row) throw new Error("Failed to create general chat")
      return buildInfo(row, session)
    })

    const get = Effect.fn("GeneralChat.get")(function* (sessionID: SessionID) {
      const session = yield* sessions.get(sessionID)
      const root = yield* resolveRoot(sessionID)
      const row = yield* getRow(root.id)
      return buildInfo(row, session)
    })

    const delete_ = Effect.fn("GeneralChat.delete")(function* (sessionID: SessionID) {
      const root = yield* resolveRoot(sessionID)
      const row = yield* getRow(root.id)
      yield* sessions.remove(root.id)
      yield* fs.remove(row.directory, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void))
    })

    return Service.of({
      list,
      create,
      get,
      delete: delete_,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
  Layer.provide(Session.defaultLayer),
)

export const use = serviceUse(Service)

export * as GeneralChat from "./general-chat"
