import { afterEach, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { EffectContextBridge } from "../../src/effect/context-bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceState } from "../../src/effect/instance-state"
import { attach } from "../../src/effect/run-service"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppFileSystem.defaultLayer)

afterEach(async () => {
  await disposeAllInstances()
})

// Regression for PR #25522: when an effectCmd handler does
// `yield* Effect.promise(async () => { ... await runPromise(svcMethod) ... })`,
// the inner runPromise creates a fresh fiber after `await` whose Effect context
// has lost the outer InstanceRef. The explicit bridge carries that same
// InstanceRef value across the JS async callback boundary.
it.live("effect-cmd.ts wraps the handler body in the explicit context bridge", () =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const source = yield* fs.readFileString(fileURLToPath(new URL("../../src/cli/effect-cmd.ts", import.meta.url)))
    expect(source).toContain("EffectContextBridge.restore({ instance: ctx }")
  }),
)

it.instance(
  "InstanceRef reachable after await inside bridged Effect.promise(async)",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const ctx = yield* InstanceRef
      if (!ctx) throw new Error("InstanceRef not provided")

      const directory = yield* Effect.promise(() =>
        EffectContextBridge.restore({ instance: ctx }, async () => {
          await Promise.resolve()
          return Effect.runPromise(attach(InstanceState.directory))
        }),
      )

      expect(directory).toBe(test.directory)
    }),
  { git: true },
)
