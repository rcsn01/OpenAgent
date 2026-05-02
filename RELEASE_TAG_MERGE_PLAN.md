# Release Tag Merge Plan

Read this file and [`AGENTS.md`](/Users/mac/Syncthing/Projects/OpenAgent/AGENTS.md) before merging an official OpenCode release tag into this fork.

## Goal

Merge an official OpenCode release tag like `v1.14.31` into this fork while keeping the fork's GUI-first customizations intact and keeping core divergence as small as possible.

## Important Facts

- This repo's default branch is `dev`.
- `origin` is this fork.
- `upstream` is the official `anomalyco/opencode` repo.
- Official packaged releases are best tracked by release tags like `vX.Y.Z`, not just by `upstream/dev`.
- In OpenCode's release flow, the release tag may point to a release-specific commit created by CI, so do not assume the tag is identical to the tip of `upstream/dev`.
- If the user asks for a release sync, merge the tag itself. Do not silently substitute `upstream/dev`.

## Safety Rules

- Never use `git reset --hard` or revert unrelated user changes.
- If the current worktree is dirty and the merge would touch the same files, stop and ask the user how they want to proceed.
- Prefer using a temporary merge branch like `merge/release-vX.Y.Z`.
- Use non-interactive git commands only.

## Standard Flow

1. Read `AGENTS.md` and this file.
2. Fetch the latest upstream refs and tags.

```bash
git fetch upstream --tags
git fetch origin
```

3. Pick the target tag.

- If the user named a tag, use that exact tag.
- If the user said "latest official release", resolve the newest official stable tag from upstream releases.
- If the user wants beta behavior instead of stable, clarify that before merging.

4. Inspect what is about to land.

```bash
git show --stat vX.Y.Z
git branch -r --contains vX.Y.Z
git log --oneline --decorate origin/dev..vX.Y.Z
git log --oneline --decorate vX.Y.Z..origin/dev
git diff --stat vX.Y.Z...origin/dev -- packages/opencode packages/app packages/ui packages/desktop-electron packages/desktop
```

5. Before merging, resolving conflicts, editing files, or committing anything, list all important differences and changes for the user and ask what should be included and what should not be included.

- Do not make judgment calls about conflict resolution on your own.
- Do not start the merge until the user has reviewed the differences and given direction on what to keep.

6. Start from the fork branch that should receive the merge.

- Default target is `origin/dev`.
- If the user wants another branch, use that instead.

```bash
git switch dev
git merge --ff-only origin/dev
git switch -c merge/release-vX.Y.Z
```

7. Merge the official release tag.

```bash
git merge --no-ff vX.Y.Z
```

8. Resolve conflicts only according to the user's directions.

9. Regenerate generated files only if the merge touched the relevant generators or generated outputs.

- JavaScript SDK: `./packages/sdk/js/script/build.ts`

10. Verify from package directories, never from repo root.

```bash
# Run in touched package directories only
bun run typecheck
```

Default verification set for release merges:

- `packages/opencode`
- `packages/app`
- `packages/ui`
- `packages/desktop-electron`

Also verify `packages/desktop` if the Tauri wrapper was touched.

11. Summarize what changed, what was kept from the fork, and any remaining risks before committing or opening a PR.

## Fork-Specific Biases

- This fork is GUI-first.
- Keep upstream core as close to official as practical.
- Avoid introducing fresh custom logic in `packages/opencode` unless it is truly required for the fork's product direction.
- Electron is the first-class desktop target in this fork. Tauri can exist, but it should not drive merge decisions unless the merge actually touches it.

## Good Final Checks

- The tag itself was merged, not substituted with `upstream/dev`.
- No unrelated local changes were reverted.
- The user reviewed the differences before the merge work began and explicitly said what should and should not be included.
- Any intentional fork deviations are called out in the final summary.
- Touched packages typecheck successfully.
- Desktop startup and app/core boundary changes were reviewed if session, server, or platform code changed.
- If generated files changed, they were regenerated intentionally rather than hand-edited.

## Short Version

When asked to merge an official OpenCode release into this fork:

1. Fetch upstream tags.
2. Find and present all meaningful differences and changes.
3. Ask the user what should and should not be included before merging or resolving anything.
4. Merge the exact release tag into a temporary branch like `merge/release-vX.Y.Z` off `origin/dev`.
5. Verify with package-level `bun run typecheck`.
6. Report what was preserved, what changed, and any follow-up cleanup needed.
