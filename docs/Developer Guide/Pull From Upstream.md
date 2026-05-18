# Pull From Upstream

Use this guide to compare OpenAgent against upstream `opencode`, then merge the parts that should be carried forward.

There are two separate workflows:

1. Inspect what upstream added since the last upstream commit present in OpenAgent.
2. Merge upstream changes into OpenAgent using the OpenAgent merge policy.

Do the inspection first. Do not start applying code until the upstream-only change set is clear.

## 1. Confirm Remotes

```bash
git remote -v
```

Expected remotes:

```text
origin    https://github.com/rcsn01/OpenAgent.git
upstream  https://github.com/anomalyco/opencode.git
```

If `upstream` is missing:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
```

## 2. Fetch Upstream Tags

```bash
git fetch upstream --tags
```

This updates local knowledge of upstream branches and release tags.

## 3. Find the Latest Upstream Release Tag

```bash
git tag --list 'v[0-9]*' --sort=-v:refname | head -10
```

The first tag is the latest release tag known locally. Example:

```text
v1.15.4
```

Get the commit for that tag:

```bash
git show -s --format='%H%n%h%n%ci%n%s' v1.15.4
```

## 4. Find the Last Upstream Commit in This Branch

Use the merge base between the current branch and upstream `dev`:

```bash
git merge-base HEAD upstream/dev
```

Show that commit:

```bash
git show -s --format='%H%n%h%n%ci%n%s' "$(git merge-base HEAD upstream/dev)"
```

This is the latest commit that both OpenAgent and upstream `opencode` share.

## 5. Count What Upstream Added Since Then

Replace `v1.15.4` with the latest tag from step 3 if needed.

```bash
git rev-list --count "$(git merge-base HEAD upstream/dev)"..v1.15.4
```

This number is how many upstream commits OpenAgent is behind that release.

## 6. List the Upstream Commits

```bash
git log --oneline --no-merges "$(git merge-base HEAD upstream/dev)"..v1.15.4
```

This answers: "What did opencode add since the last upstream commit this branch has?"

## 7. Summarize the Upstream File Changes

```bash
git diff --shortstat "$(git merge-base HEAD upstream/dev)" v1.15.4
git diff --dirstat=files,0 "$(git merge-base HEAD upstream/dev)" v1.15.4
git diff --name-status "$(git merge-base HEAD upstream/dev)" v1.15.4
```

Use these to understand the size, affected areas, and changed files in upstream.

## 8. Summarize by Product Area

After listing the upstream-only commits and files, group the changes into the areas that matter for OpenAgent:

- Backend: `packages/opencode/src`, `packages/opencode/test`, `packages/sdk`, server, sync, tools, config, runtime, LSP, and storage changes
- TUI: `packages/opencode/src/cli/cmd/tui`, `packages/opencode/test/cli/cmd/tui`, and terminal UI dependencies
- Desktop app: `packages/app` and `packages/desktop`

Useful commands:

```bash
git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- packages/opencode/src packages/opencode/test packages/sdk
git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- packages/opencode/src/cli/cmd/tui packages/opencode/test/cli/cmd/tui
git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- packages/app packages/desktop
```

Then explain the result in plain language. For example:

```text
Backend: runtime context fixes, tool fixes, LSP/watch fixes, tests.
TUI: thinking mode, pinned sessions, prompt history, markdown rendering.
Desktop app: version bumps only, unless files under packages/app or packages/desktop changed beyond package metadata.
```

This keeps the answer focused on what upstream `opencode` changed, not what OpenAgent changed locally.

## 9. Do Not Compare Against OpenAgent HEAD for This Question

For upstream-only inspection, do not use:

```bash
git diff HEAD v1.15.4
```

That compares OpenAgent fork work against upstream and mixes local fork changes with upstream changes.

The correct comparison is:

```bash
git diff "$(git merge-base HEAD upstream/dev)" v1.15.4
```

## 10. Create a Dedicated Merge Branch

After inspection, create a merge branch from the current OpenAgent development branch.

```bash
git switch dev
git status --short
git switch -c merge/upstream-v1.15.4-tui-backend
```

Use the latest tag in the branch name. If the working tree is not clean, understand those changes before branching. Do not overwrite unrelated local work.

## 11. Merge TUI Changes Directly

TUI code should stay close to upstream. Once the upstream TUI file list is known, restore those files from the latest upstream tag.

TUI paths usually include:

```text
packages/opencode/src/cli/cmd/tui
packages/opencode/test/cli/cmd/tui
packages/opencode/src/cli/cmd/prompt-display.ts
```

Example:

```bash
git restore --source="$LATEST_TAG" -- \
  packages/opencode/src/cli/cmd/prompt-display.ts \
  packages/opencode/src/cli/cmd/tui \
  packages/opencode/test/cli/cmd/tui
```

If upstream added new TUI files, make sure they appear as untracked files and are included later.

Also apply TUI dependency bumps when upstream changed them. For OpenTUI updates, check `package.json`, then run:

```bash
bun install
```

This updates `bun.lock`. Keep the lockfile change with the merge.

## 12. Do Not Bulk-Merge Backend or Server Changes

Backend/server changes are not merged by restoring whole directories. OpenAgent has local server behavior that upstream does not know about, including automation, general chat, specialist tools, shared server behavior, and legacy instance compatibility.

For backend/server files, first list the upstream changes:

```bash
git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- \
  packages/opencode/src \
  packages/opencode/test \
  packages/sdk
```

Then compare that list with local OpenAgent changes:

```bash
git diff --name-status "$LAST_UPSTREAM"..HEAD -- \
  packages/opencode/src \
  packages/opencode/test \
  packages/sdk
```

Classify each backend change:

- Safe direct port: file has no OpenAgent-specific local changes and upstream change is self-contained.
- Careful manual port: file already has OpenAgent behavior, so copy the upstream intent into the current file by hand.
- Defer or skip: upstream removed/reworked a compatibility layer that OpenAgent still depends on.

Never delete OpenAgent-only server/runtime files just because upstream deleted an older equivalent. Check references first with `rg`.

## 13. Backend Review Checklist

For each backend/server upstream change, answer these questions before editing:

- What behavior did upstream change?
- Does OpenAgent already have local changes in the same file?
- Does the upstream change depend on a larger upstream refactor?
- Does applying it break automation, general chat, specialist tools, shared server mode, or legacy instance context?
- What focused test or typecheck covers the change?

Useful reference commands:

```bash
git diff "$LAST_UPSTREAM" "$LATEST_TAG" -- path/to/file.ts
git diff "$LAST_UPSTREAM"..HEAD -- path/to/file.ts
rg -n "symbolOrImportName" packages/opencode/src packages/opencode/test
```

## 14. Backend Patterns From the v1.15.4 Merge

The `v1.15.4` merge established these rules:

- On branches before `migration/explicit-instance-context`, keep `project/instance.ts` and `project/with-instance.ts` while OpenAgent still references them.
- On branches after `migration/explicit-instance-context`, do not reintroduce `project/instance.ts`, `project/with-instance.ts`, or `Instance.restore`; use `InstanceRef`, `InstanceStore`, and the explicit effect context bridge.
- Preserve OpenAgent's general-chat directory resolver in HTTP instance middleware.
- Provide `InstanceRef` explicitly in request/runtime boundaries.
- For sync and bus changes, preserve existing module-level subscribers while adding explicit instance/workspace context for new publish paths.
- For workspace adapters, pass explicit instance/workspace context, but keep fallbacks that work with OpenAgent's current instance state.
- For ACP/default-agent lookups, run directory-scoped effects with a loaded instance context.
- Do not remove OpenAgent-specific tools, registry gating, automation routes, or shared server behavior while porting upstream tool/runtime fixes.

## 15. Validate the Merge

Run typecheck from the repo root:

```bash
bun run typecheck
```

Run focused tests for the changed areas from `packages/opencode`. Example set from the `v1.15.4` merge:

```bash
cd packages/opencode
bun test --timeout 30000 test/cli/cmd/tui/aggregate-failures.test.ts test/cli/cmd/tui/prompt-history.test.ts
bun test --timeout 30000 test/sync/index.test.ts
OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=1 bun test --timeout 30000 test/lsp/client.test.ts
cd ../..
```

Workspace/control-plane tests may need local environment workarounds. If tests fail due to local infrastructure, record the exact failure. For example, a local `NodeHttpServer` `ServeError` while binding port `0` is different from a code regression in workspace logic.

Always run:

```bash
git diff --check
git status --short
```

## 16. Summarize What Was Merged

When reporting the merge, separate the result by product area:

- Backend: runtime, server, sync, config, LSP, tools, and tests
- TUI: terminal UI behavior, prompt display/history, UI dependency bumps, and TUI tests
- Desktop app: `packages/app`, `packages/desktop`, desktop package metadata, or no changes

Also call out anything intentionally not merged. Example:

```text
Did not take upstream's deletion of project/instance.ts because OpenAgent still depends on that compatibility layer.
```

## Quick Command Set

```bash
git fetch upstream --tags
LATEST_TAG="$(git tag --list 'v[0-9]*' --sort=-v:refname | head -1)"
LAST_UPSTREAM="$(git merge-base HEAD upstream/dev)"

git show -s --format='%H %s' "$LAST_UPSTREAM"
git show -s --format='%H %s' "$LATEST_TAG"
git rev-list --count "$LAST_UPSTREAM..$LATEST_TAG"
git log --oneline --no-merges "$LAST_UPSTREAM..$LATEST_TAG"
git diff --shortstat "$LAST_UPSTREAM" "$LATEST_TAG"
git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- packages/opencode/src packages/opencode/test packages/sdk
git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- packages/opencode/src/cli/cmd/tui packages/opencode/test/cli/cmd/tui
git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- packages/app packages/desktop
```

## Quick Merge Command Set

```bash
git switch dev
git switch -c "merge/upstream-${LATEST_TAG}-tui-backend"

git restore --source="$LATEST_TAG" -- \
  packages/opencode/src/cli/cmd/prompt-display.ts \
  packages/opencode/src/cli/cmd/tui \
  packages/opencode/test/cli/cmd/tui

bun install

git diff --name-status "$LAST_UPSTREAM" "$LATEST_TAG" -- packages/opencode/src packages/opencode/test packages/sdk
git diff --name-status "$LAST_UPSTREAM"..HEAD -- packages/opencode/src packages/opencode/test packages/sdk

bun run typecheck
git diff --check
git status --short
```

The quick merge command set is only the scaffold. Backend/server edits still require the manual review policy above.
