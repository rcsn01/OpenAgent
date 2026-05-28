import { Context, Effect, Exit, Fiber } from "effect"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceID } from "@/control-plane/schema"
import { InstanceRef, WorkspaceRef } from "./instance-ref"
import { attachWith } from "./run-service"
import { EffectContextBridge } from "./context-bridge"

export interface Shape {
  readonly promise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>
  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>
  readonly bind: <Args extends readonly unknown[], Result>(fn: (...args: Args) => Result) => (...args: Args) => Result
}

function restore<R>(instance: InstanceContext | undefined, workspace: WorkspaceID | undefined, fn: () => R): R {
  if (instance || workspace !== undefined) return EffectContextBridge.restore({ instance, workspace }, fn)
  return fn()
}

function captureSync() {
  const fiber = Fiber.getCurrent()
  const bridged = EffectContextBridge.current()
  const instance = (fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : undefined) ?? bridged.instance
  const workspace =
    (fiber ? Context.getReferenceUnsafe(fiber.context, WorkspaceRef) : undefined) ??
    bridged.workspace ??
    WorkspaceContext.workspaceID
  return { instance, workspace }
}

export const bind = <Args extends readonly unknown[], Result>(fn: (...args: Args) => Result) => {
  const captured = captureSync()
  return (...args: Args) =>
    restore(captured.instance, captured.workspace, () =>
      Effect.runSync(
        attachWith(
          Effect.sync(() => fn(...args)),
          captured,
        ),
      ),
    )
}

/**
 * Bridge from Effect into a Promise-returning JS callback while carrying
 * explicit `InstanceRef` and `WorkspaceRef` values across the JS async
 * boundary. Effect fiber context does not propagate across every
 * `Effect.promise(() => async fn)` re-entry path, but this bridge does.
 *
 * Mirrors `Effect.promise` but restores explicit refs first.
 */
export const fromPromise = <T>(fn: () => Promise<T> | T): Effect.Effect<T> =>
  Effect.gen(function* () {
    const instance = yield* InstanceRef
    const workspace = yield* WorkspaceRef
    return yield* Effect.promise(() => Promise.resolve(restore(instance, workspace, () => fn())))
  })

export function make(): Effect.Effect<Shape> {
  return Effect.gen(function* () {
    const ctx = yield* Effect.context()
    const value = yield* InstanceRef
    const bridged = EffectContextBridge.current()
    const instance = value ?? bridged.instance
    const workspace = (yield* WorkspaceRef) ?? WorkspaceContext.workspaceID
    const attach = <A, E, R>(effect: Effect.Effect<A, E, R>) => attachWith(effect, { instance, workspace })
    const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      attach(effect).pipe(Effect.provide(ctx)) as Effect.Effect<A, E, never>

    return {
      promise: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        restore(instance, workspace, () => Effect.runPromise(wrap(effect))),
      fork: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        restore(instance, workspace, () => Effect.runFork(wrap(effect))),
      run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.callback<A, E>((resume) => {
          restore(instance, workspace, () =>
            Effect.runPromiseExit(wrap(effect)).then((exit) =>
              resume(Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause)),
            ),
          )
        }),
      bind:
        <Args extends readonly unknown[], Result>(fn: (...args: Args) => Result) =>
        (...args: Args) =>
          restore(instance, workspace, () => Effect.runSync(wrap(Effect.sync(() => fn(...args))))),
    } satisfies Shape
  })
}

export * as EffectBridge from "./bridge"
