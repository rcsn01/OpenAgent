import { AppRuntime } from "@/effect/app-runtime"
import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForReload } from "../lifecycle"

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const opened = Effect.fn("ProjectHttpApi.opened")(function* () {
      return yield* svc.opened()
    })

    const open = Effect.fn("ProjectHttpApi.open")(function* (ctx: { payload: Project.OpenPayload }) {
      return yield* svc.open(ctx.payload.directory)
    })

    const close = Effect.fn("ProjectHttpApi.close")(function* (ctx: {
      params: { projectID: ProjectID }
      query: { directory?: string }
    }) {
      return yield* svc.close({ projectID: ctx.params.projectID, directory: ctx.query.directory })
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID })
    })

    return handlers
      .handle("list", list)
      .handle("opened", opened)
      .handle("open", open)
      .handle("close", close)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("update", update)
  }),
)
