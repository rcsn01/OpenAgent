# Instance Context Migration

Use this guide to migrate OpenAgent away from the legacy ambient `Instance.current` layer and toward upstream's explicit `InstanceRef` / `InstanceStore` context model.

Status: implemented on `migration/explicit-instance-context`.

This migration should happen on a dedicated branch after the upstream merge branch has landed in `dev`.

Current branch:

```text
migration/explicit-instance-context
```

## Goal

The migration removes OpenAgent's dependency on:

- `packages/openagent/src/project/instance.ts`
- `packages/openagent/src/project/with-instance.ts`
- fallback reads from `Instance.current`
- fallback async context restoration through `Instance.restore`

The replacement pattern is explicit Effect context:

- `InstanceRef` for the loaded `InstanceContext`
- `WorkspaceRef` when a request/session is workspace-scoped
- `InstanceStore` for loading instance context at process, CLI, test, and HTTP boundaries
- `InstanceState.directory`, `InstanceState.context`, and related helpers for runtime reads

## Why Migrate

Upstream opencode is moving away from ambient AsyncLocalStorage state and toward explicit context. Keeping the legacy layer makes every future upstream pull harder, because upstream changes increasingly assume `InstanceRef` is available instead of `Instance.current`.

OpenAgent kept the compatibility layer during the `v1.15.4` merge because server/runtime paths still depended on it. This migration removes those dependencies deliberately.

## Known Legacy Hot Spots

Production paths that still need attention:

```text
packages/openagent/src/cli/bootstrap.ts
packages/openagent/src/cli/effect-cmd.ts
packages/openagent/src/command/index.ts
packages/openagent/src/effect/bridge.ts
packages/openagent/src/effect/instance-state.ts
packages/openagent/src/effect/run-service.ts
packages/openagent/src/format/formatter.ts
packages/openagent/src/server/routes/instance/httpapi/handlers/experimental.ts
packages/openagent/src/session/session.ts
packages/openagent/src/tool/repo_overview.ts
```

Test and fixture paths with broad legacy usage:

```text
packages/openagent/test/fixture/fixture.ts
packages/openagent/test/config/config.test.ts
packages/openagent/test/control-plane/workspace.test.ts
packages/openagent/test/lsp/client.test.ts
packages/openagent/test/provider/amazon-bedrock.test.ts
packages/openagent/test/provider/provider.test.ts
packages/openagent/test/session/llm.test.ts
```

Refresh the list before editing:

```bash
rg -n "project/instance|project/with-instance|Instance\\.|WithInstance|Instance\\.restore|Instance\\.current" \
  packages/openagent/src packages/openagent/test
```

## Migration Rules

- Do not remove `project/instance.ts` or `project/with-instance.ts` first. They are removed only after all source and test references are gone.
- Do not replace async context behavior blindly. `effect-cmd.ts` has a regression test proving `Instance.restore` currently protects async callbacks that re-enter Effect after `await`.
- Prefer explicit Effect services over module-level globals.
- Keep request/session/workspace boundaries responsible for loading and providing context.
- Keep changes small enough that each phase can be typechecked and tested independently.

## Step 1: Type-Only Imports

Move type-only imports from `project/instance` to `project/instance-context`.

Examples:

```ts
import type { InstanceContext } from "@/project/instance-context"
```

Likely files:

```text
packages/openagent/src/command/index.ts
packages/openagent/src/format/formatter.ts
packages/openagent/src/session/session.ts
packages/openagent/src/effect/run-service.ts
packages/openagent/src/effect/bridge.ts
packages/openagent/src/effect/instance-state.ts
```

Validate:

```bash
bun run typecheck
```

## Step 2: Simple Runtime Reads

Replace direct ambient reads with explicit runtime reads.

Common replacements:

```text
Instance.directory -> yield* InstanceState.directory
Instance.current   -> yield* InstanceState.context
Instance.project   -> (yield* InstanceState.context).project
Instance.worktree  -> (yield* InstanceState.context).worktree
```

Likely files:

```text
packages/openagent/src/tool/repo_overview.ts
packages/openagent/src/server/routes/instance/httpapi/handlers/experimental.ts
packages/openagent/src/cli/bootstrap.ts
```

When a function is not already an Effect, either move the context read to its Effect caller or pass the needed context in as an explicit parameter.

Validate:

```bash
bun run typecheck
bun test --timeout 30000 packages/openagent/test/tool/read.test.ts
```

## Step 3: CLI and Bootstrap Boundaries

Update CLI/bootstrap paths so they load instance context through `InstanceStore` and provide `InstanceRef` explicitly.

Targets:

```text
packages/openagent/src/cli/bootstrap.ts
packages/openagent/src/cli/effect-cmd.ts
```

Expected direction:

- Load context once at the command boundary with `InstanceStore`.
- Provide `InstanceRef` to the command Effect.
- Keep cleanup/dispose behavior tied to the same loaded context.
- Remove the need for `WithInstance.provide(...)` in bootstrap.

Do not remove `Instance.restore` from `effect-cmd.ts` until Step 4 is complete.

Validate:

```bash
bun run typecheck
bun test --timeout 30000 packages/openagent/test/project/instance-bootstrap.test.ts
bun test --timeout 30000 packages/openagent/test/cli/effect-cmd-instance-als.test.ts
```

## Step 4: Replace the Async Callback Bridge

This is the risky step.

`packages/openagent/src/cli/effect-cmd.ts` currently uses `Instance.restore(ctx, ...)` so async callbacks that cross an `await` and then re-enter Effect can still find instance context. The regression coverage is:

```text
packages/openagent/test/cli/effect-cmd-instance-als.test.ts
```

Before deleting `Instance.restore`, introduce an explicit bridge that preserves context for these callback paths without ambient `Instance.current`.

The replacement must prove:

- `InstanceRef` is still available after an `await`.
- command handlers that call back into Effect after async work keep the same instance context.
- active HTTP/server/session paths do not lose context and render blank.

Expected validation:

```bash
bun test --timeout 30000 packages/openagent/test/cli/effect-cmd-instance-als.test.ts
OPENAGENT_EXPERIMENTAL_DISABLE_FILEWATCHER=1 bun test --timeout 30000 packages/openagent/test/server/httpapi-session.test.ts
OPENAGENT_EXPERIMENTAL_DISABLE_FILEWATCHER=1 bun test --timeout 30000 packages/openagent/test/server/httpapi-promptasync-context.test.ts
```

After the new bridge is in place, update the regression test so it asserts the explicit-context behavior instead of checking for `Instance.restore(ctx` in source text.

## Step 5: Effect Runtime Helpers

Remove legacy fallbacks from:

```text
packages/openagent/src/effect/bridge.ts
packages/openagent/src/effect/run-service.ts
packages/openagent/src/effect/instance-state.ts
```

Expected end state:

- `withEffectContext` and related helpers use `InstanceRef` / `WorkspaceRef`.
- `InstanceState.context` no longer falls back to `Instance.current`.
- runtime helpers fail clearly when called without required context.

Validate:

```bash
bun run typecheck
bun test --timeout 30000 packages/openagent/test/effect/run-service.test.ts
bun test --timeout 30000 packages/openagent/test/effect/instance-state.test.ts
```

## Step 6: Test Fixtures

Migrate fixtures from `WithInstance.provide(...)` and `Instance.restore(...)` to `InstanceStore` / `InstanceRef`.

Primary fixture files:

```text
packages/openagent/test/fixture/fixture.ts
packages/openagent/test/fixture/workspace.ts
```

Desired fixture behavior:

- `it.instance(...)` creates or loads an `InstanceContext`.
- tests run with `InstanceRef` provided.
- workspace-scoped tests also provide `WorkspaceRef`.
- Promise-style tests use helpers that preserve context explicitly.

After fixture migration, convert test files in batches:

```text
packages/openagent/test/config/config.test.ts
packages/openagent/test/control-plane/workspace.test.ts
packages/openagent/test/lsp/client.test.ts
packages/openagent/test/provider/amazon-bedrock.test.ts
packages/openagent/test/provider/provider.test.ts
packages/openagent/test/session/llm.test.ts
```

Validate each batch independently.

## Step 7: Delete Legacy Modules

Only after `rg` shows no source or test dependency, delete:

```text
packages/openagent/src/project/instance.ts
packages/openagent/src/project/with-instance.ts
```

Final check:

```bash
rg -n "project/instance|project/with-instance|Instance\\.|WithInstance|Instance\\.restore|Instance\\.current" \
  packages/openagent/src packages/openagent/test
```

Acceptable remaining matches should be documentation, migration notes, or tests specifically proving the old APIs are gone.

## Final Validation

Run:

```bash
bun run typecheck
git diff --check
```

Run focused tests:

```bash
bun test --timeout 30000 packages/openagent/test/cli/effect-cmd-instance-als.test.ts
bun test --timeout 30000 packages/openagent/test/effect/run-service.test.ts
bun test --timeout 30000 packages/openagent/test/effect/instance-state.test.ts
bun test --timeout 30000 packages/openagent/test/project/instance-bootstrap.test.ts
OPENAGENT_EXPERIMENTAL_DISABLE_FILEWATCHER=1 bun test --timeout 30000 packages/openagent/test/lsp/client.test.ts
OPENAGENT_EXPERIMENTAL_DISABLE_FILEWATCHER=1 bun test --timeout 30000 packages/openagent/test/server/httpapi-session.test.ts
OPENAGENT_EXPERIMENTAL_DISABLE_FILEWATCHER=1 bun test --timeout 30000 packages/openagent/test/server/httpapi-promptasync-context.test.ts
```

If time allows, run the broader opencode suite with file watching disabled:

```bash
cd packages/openagent
OPENAGENT_EXPERIMENTAL_DISABLE_FILEWATCHER=1 bun test --timeout 30000
```

## Completion Criteria

The migration is complete when:

- source code no longer imports `project/instance` or `project/with-instance`
- tests no longer rely on `WithInstance.provide`
- async command callbacks keep instance context without `Instance.restore`
- `project/instance.ts` and `project/with-instance.ts` are deleted
- typecheck passes
- focused CLI/effect/server/session tests pass
