# Pull From Upstream

Use this guide to see what upstream `opencode` has added since the last upstream commit already present in OpenAgent.

This is an inspection workflow. It does not merge or change files.

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
