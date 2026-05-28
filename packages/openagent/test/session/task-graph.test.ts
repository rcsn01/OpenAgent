import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@openagent-ai/core/cross-spawn-spawner"
import { SessionTaskGraph } from "../../src/session/task-graph"
import { SessionID } from "../../src/session/schema"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const it = testEffect(Layer.mergeAll(SessionTaskGraph.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("session.task-graph", () => {
  it.live("rejects duplicate ids, unknown dependencies, self dependencies, and cycles", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const graph = yield* SessionTaskGraph.Service
        const parentSessionID = SessionID.make("ses_parent")
        const deliver = () => Effect.void

        const duplicate = yield* graph
          .submit({
            parentSessionID,
            origin: "background_task_graph",
            deliver,
            nodes: [
              {
                nodeID: "dup",
                description: "first",
                agent: "general",
                prepare: () => Effect.succeed({ sessionID: SessionID.make("ses_dup1"), run: Effect.never }),
              },
              {
                nodeID: "dup",
                description: "second",
                agent: "general",
                prepare: () => Effect.succeed({ sessionID: SessionID.make("ses_dup2"), run: Effect.never }),
              },
            ],
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(duplicate)).toBe(true)
        if (Exit.isFailure(duplicate)) {
          expect(String(Cause.squash(duplicate.cause))).toContain("Duplicate task graph node id")
        }

        const unknownDependency = yield* graph
          .submit({
            parentSessionID,
            origin: "background_task_graph",
            deliver,
            nodes: [
              {
                nodeID: "known",
                description: "known",
                agent: "general",
                dependencies: ["missing"],
                prepare: () => Effect.succeed({ sessionID: SessionID.make("ses_known"), run: Effect.never }),
              },
            ],
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(unknownDependency)).toBe(true)
        if (Exit.isFailure(unknownDependency)) {
          expect(String(Cause.squash(unknownDependency.cause))).toContain("Unknown task graph dependency")
        }

        const selfDependency = yield* graph
          .submit({
            parentSessionID,
            origin: "background_task_graph",
            deliver,
            nodes: [
              {
                nodeID: "self",
                description: "self",
                agent: "general",
                dependencies: ["self"],
                prepare: () => Effect.succeed({ sessionID: SessionID.make("ses_self"), run: Effect.never }),
              },
            ],
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(selfDependency)).toBe(true)
        if (Exit.isFailure(selfDependency)) {
          expect(String(Cause.squash(selfDependency.cause))).toContain("cannot depend on itself")
        }

        const cycle = yield* graph
          .submit({
            parentSessionID,
            origin: "background_task_graph",
            deliver,
            nodes: [
              {
                nodeID: "a",
                description: "a",
                agent: "general",
                dependencies: ["b"],
                prepare: () => Effect.succeed({ sessionID: SessionID.make("ses_a"), run: Effect.never }),
              },
              {
                nodeID: "b",
                description: "b",
                agent: "general",
                dependencies: ["a"],
                prepare: () => Effect.succeed({ sessionID: SessionID.make("ses_b"), run: Effect.never }),
              },
            ],
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(cycle)).toBe(true)
        if (Exit.isFailure(cycle)) {
          expect(String(Cause.squash(cycle.cause))).toContain("contains a cycle")
        }
      }),
    ),
  )

  it.live("launches root nodes immediately and waits for dependencies before starting dependents", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const graph = yield* SessionTaskGraph.Service
        const parentSessionID = SessionID.make("ses_parent")
        const firstStarted = defer<void>()
        const firstRelease = defer<void>()
        const secondStarted = defer<void>()
        const secondRelease = defer<void>()

        const submitted = yield* graph.submit({
          parentSessionID,
          origin: "background_task_graph",
          deliver: () => Effect.void,
          nodes: [
            {
              nodeID: "first",
              description: "first",
              agent: "general",
              prepare: () =>
                Effect.succeed({
                  sessionID: SessionID.make("ses_first"),
                  run: Effect.promise(async () => {
                    firstStarted.resolve()
                    await firstRelease.promise
                    return { title: "first", output: "done one" }
                  }),
                }),
            },
            {
              nodeID: "second",
              description: "second",
              agent: "general",
              dependencies: ["first"],
              prepare: () =>
                Effect.succeed({
                  sessionID: SessionID.make("ses_second"),
                  run: Effect.promise(async () => {
                    secondStarted.resolve()
                    await secondRelease.promise
                    return { title: "second", output: "done two" }
                  }),
                }),
            },
          ],
        })

        expect(submitted.nodes.find((node) => node.nodeID === "first")?.status).toBe("running")
        expect(submitted.nodes.find((node) => node.nodeID === "second")?.status).toBe("pending")

        yield* Effect.promise(() => firstStarted.promise)

        let secondLaunchedEarly = false
        void secondStarted.promise.then(() => {
          secondLaunchedEarly = true
        })
        yield* Effect.promise(() => Promise.resolve())
        expect(secondLaunchedEarly).toBe(false)

        yield* Effect.sync(() => firstRelease.resolve())
        yield* Effect.promise(() => secondStarted.promise)

        const running = yield* graph.get(submitted.graphID)
        expect(running?.nodes.find((node) => node.nodeID === "first")?.status).toBe("completed")
        expect(running?.nodes.find((node) => node.nodeID === "second")?.status).toBe("running")

        yield* Effect.sync(() => secondRelease.resolve())
      }),
    ),
  )

  it.live("keeps completed delivered graphs grouped and lists newest graphs first", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const graph = yield* SessionTaskGraph.Service
        const parentSessionID = SessionID.make("ses_parent")
        const oldStarted = defer<void>()
        const oldRelease = defer<void>()
        const oldDelivered = defer<void>()
        const oldSessionID = SessionID.make("ses_old")
        const newSessionID = SessionID.make("ses_new")

        const older = yield* graph.submit({
          parentSessionID,
          origin: "background_task_graph",
          deliver: () => Effect.sync(() => oldDelivered.resolve()),
          nodes: [
            {
              nodeID: "old",
              description: "old",
              agent: "general",
              prepare: () =>
                Effect.succeed({
                  sessionID: oldSessionID,
                  run: Effect.promise(async () => {
                    oldStarted.resolve()
                    await oldRelease.promise
                    return { title: "old", output: "done old" }
                  }),
                }),
            },
          ],
        })

        yield* Effect.promise(() => oldStarted.promise)
        yield* Effect.sync(() => oldRelease.resolve())
        yield* Effect.promise(() => oldDelivered.promise)

        const retained = yield* graph.get(older.graphID)
        expect(retained?.status).toBe("completed")
        expect(retained?.nodes[0]?.sessionID).toBe(oldSessionID)

        const newer = yield* graph.submit({
          parentSessionID,
          origin: "background_task_graph",
          deliver: () => Effect.void,
          nodes: [
            {
              nodeID: "new",
              description: "new",
              agent: "general",
              prepare: () => Effect.succeed({ sessionID: newSessionID, run: Effect.never }),
            },
          ],
        })

        const listed = yield* graph.list(parentSessionID)
        expect(listed.map((item) => item.graphID)).toEqual([newer.graphID, older.graphID])
        expect(listed.find((item) => item.graphID === older.graphID)?.nodes[0]?.sessionID).toBe(oldSessionID)
      }),
    ),
  )
})
