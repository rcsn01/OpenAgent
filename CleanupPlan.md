# Repo Cleanup Plan

Goal: Remove all public-project artifacts (branding, upstream release plumbing, contributor docs, CI/CD for public maintenance, security policies, issue templates, etc.) to convert this into a clean personal project fork.

**CRITICAL:** There are two `script/` directories. Do not confuse them.
- **Root `script/`** → public release automation. Safe to delete.
- **`packages/opencode/script/`** → local CLI build scripts (e.g., `build.ts`, `fix-node-pty.ts`). **DO NOT DELETE.**

---

## 1. Root-Level Files to Delete / Replace

| File/Dir | Action | Impact / Notes |
|----------|--------|----------------|
| `README.md` | **Replace** | Branded for official project. Rewrite with your own. |
| `CONTRIBUTING.md` | **Delete** | Public contributor guidelines. Safe. |
| `DEVELOPMENT.md` | **Delete** | Upstream merge instructions. Safe. |
| `RELEASE_TAG_MERGE_PLAN.md` | **Delete** | Upstream tag merge guide. Safe. |
| `SECURITY.md` | **Delete** | Public security policy. Safe. |
| `LICENSE` | **Update** | Change copyright line from `opencode` to your name. Keep MIT text. |
| `install` | **Delete** | Upstream release installer script. Safe. |
| `flake.nix` | **Delete** | Nix dev shell for public project. Safe. |
| `flake.lock` | **Delete** | Nix lock file. Safe. |
| `nix/` | **Delete** | Nix packaging. Safe. |
| `infra/` | **Delete** | SST/CDK infrastructure (Stripe, PlanetScale, Cloudflare). Nothing references this for local builds. **After deleting**, also remove `"sst"` from root `devDependencies`. |
| `github/` | **Delete** | GitHub Action package. Not in workspaces or referenced by anything. Safe. |
| `packages/docs/` | **Delete** | Docs site. Nothing depends on it. Safe. |
| `packages/enterprise/` | **Delete** | Enterprise web UI. Nothing depends on it. Safe for personal use. |
| `packages/console/app/`, `core/`, `function/`, `mail/`, `resource/` | **Delete** | Hosted cloud console with billing/auth. Nothing in the local CLI depends on these. Safe. |
| `packages/web/` | **Delete** | Landing/docs website. Nothing depends on it. Safe. |
| `packages/identity/` | **Delete** | Only contains branding logos/icons (`mark.svg`, `mark-*.png`). No package.json, no code, nothing references it. Purely upstream branding assets. Safe. |
| `packages/extensions/` | **Delete** | Zed editor extension. If you do not use Zed, delete the entire directory. If you use Zed, keep it but strip upstream branding inside. |
| `packages/function/` | **Delete** | Cloudflare-hosted functions with `@cloudflare/workers-types`, `@octokit/auth-app`, `hono`. Zero references in `packages/opencode/`. Not used by local CLI. Safe. |
| `sst-env.d.ts` | **Delete** | SST type stub. Safe only if you deleted `infra/` and all console packages. |
| `default.profraw` | **Delete** | Profiling dump artifact. Add `*.profraw` to `.gitignore`. |
| `.DS_Store` | **Delete** | macOS metadata. Already in `.gitignore`; remove the file. |
| `.turbo/` | **Delete** | Stale Turborepo cache. Regenerate after cleanup. |

---

## 2. Root `package.json` — REQUIRED EDITS

**⚠️ If you delete packages above, you MUST update root `package.json`.**

### Remove from `workspaces.packages`:
```json
"packages/console/*",
```

### Remove from `scripts`:
```json
"dev:console": "ulimit -n 10240 2>/dev/null; bun run --cwd packages/console/app dev",
"dev:storybook": "bun --cwd packages/storybook storybook",
```

### Remove from `devDependencies`:
```json
"@actions/artifact": "5.0.1",
"sst": "3.18.10",
```
(These are only needed for public CI/CD and SST infrastructure.)

### Review and remove from `dependencies` if orphaned:
```json
"@aws-sdk/client-s3": "3.933.0",
"heap-snapshot-toolkit": "1.1.3",
```
These were likely used by `infra/` or `packages/console/*`. Verify no remaining code imports them, then remove.

### Update:
- `"name"`: change from `"openagent"` to your project name.
- `"repository.url"`: change from `https://github.com/anomalyco/opencode` to your repo URL.
- `"license"` copyright: already handled by updating `LICENSE` file.

---

## 3. `.github/` Directory — Delete Entire Directory

All of this is public project governance. Zero runtime impact.

- `.github/CODEOWNERS`
- `.github/TEAM_MEMBERS`
- `.github/VOUCHED.td`
- `.github/pull_request_template.md`
- `.github/publish-python-sdk.yml`
- `.github/ISSUE_TEMPLATE/` (all)
- `.github/workflows/` (all)
- `.github/actions/` (all)

> If you want personal CI (e.g., just `test.yml`), keep the directory and delete only the public-maintenance files. But deleting everything and starting fresh is cleaner.

---

## 4. Root `script/` — Prune (NOT `packages/opencode/script/`)

The root `script/` directory is for **public release automation**.

| Script | Action | Rationale |
|--------|--------|-----------|
| `script/publish.ts` | **Delete** | Publishes to npm/registry. |
| `script/beta.ts` | **Delete** | Beta releases. |
| `script/changelog.ts` | **Delete** | Public changelogs. |
| `script/raw-changelog.ts` | **Delete** | Changelog helper. |
| `script/duplicate-pr.ts` | **Delete** | Duplicate PR detection. |
| `script/stats.ts` | **Delete** | Contributor stats. |
| `script/version.ts` | **Delete** | Version bumping for releases. |
| `script/release` | **Delete** | Release script. |
| `script/sign-windows.ps1` | **Delete** | Windows code-signing. |
| `script/sync-zed.ts` | **Delete** | Zed extension sync. |
| `script/github/` | **Delete** | GitHub operation sub-scripts. |
| `script/format.ts` | **Keep** | Formatter — useful locally. |
| `script/generate.ts` | **Keep** | SDK generator — useful for local dev. |
| `script/hooks/` | **Keep** | Git hooks — useful locally. |

> **DO NOT TOUCH `packages/opencode/script/`**. It contains `build.ts`, `fix-node-pty.ts`, and other local build scripts required by the CLI.

---

## 5. `.opencode/` — Prune Carefully

| File | Action | Rationale |
|------|--------|-----------|
| `.opencode/agent/triage.md` | **Delete** | Public issue triage. |
| `.opencode/agent/duplicate-pr.md` | **Delete** | Public PR detection. |
| `.opencode/command/translate.md` | **Delete** | Docs translation. |
| `.opencode/command/spellcheck.md` | **Delete** | Docs spellcheck. |
| `.opencode/command/changelog.md` | **Delete** | Public changelog. |
| `.opencode/command/issues.md` | **Delete** | Public issue management. |
| `.opencode/command/commit.md` | **Review** | If it enforces conventional commits for public, update or delete. |
| `.opencode/command/ai-deps.md` | **Review** | If project-specific, delete. |
| `.opencode/command/rmslop.md` | **Review** | If project-specific, delete. |
| `.opencode/command/learn.md` | **Review** | If project-specific, delete. |
| `.opencode/tool/github-triage.ts` | **Delete** | GitHub triage. |
| `.opencode/tool/github-pr-search.ts` | **Delete** | GitHub PR search. |
| `.opencode/glossary/` | **Delete** | Multi-language glossary. |
| `.opencode/opencode.jsonc` | **Review** | May have upstream-specific configs. Update to your preferences. |
| `.opencode/tui.json` | **Keep** | Local TUI config. |
| `.opencode/skills/` | **Keep** | `effect` and `implementation-testing` skills are project-agnostic. |

> **Review criteria for ambiguous items:** Delete if the command references GitHub APIs, public release workflows, or upstream-specific project structure.

---

## 6. Package-Level Files to Review

### What to Keep (Core Dependencies)

| Package | Why Keep |
|---------|----------|
| `packages/opencode/` | Main CLI/TUI. Everything depends on this. |
| `packages/core/` | Shared core library. `opencode` depends on it. |
| `packages/ui/` | Shared UI components. `app`, `desktop`, `desktop-electron`, `storybook` depend on it. |
| `packages/app/` | Web UI. `desktop` and `desktop-electron` depend on it. |
| `packages/desktop/` | Tauri desktop app. |
| `packages/desktop-electron/` | Electron desktop app. |
| `packages/plugin/` | Plugin system. Used by core. |
| `packages/storybook/` | UI dev storybook. Depends on `ui`. Keep if you do UI work. |
| `packages/sdk/js/` | JavaScript SDK. Core uses it. Keep if you use SDK features. |
| `packages/script/` | **Build tooling package.** `packages/opencode/script/build.ts` imports `@opencode-ai/script`. **DO NOT DELETE.** |
| `packages/containers/` | Docker definitions. Keep if you use containers. |
| `packages/slack/` | Slack integration. Keep if you use Slack. |
| `sdks/vscode/` | VSCode extension. Keep if you use VSCode. |
| `patches/` | Dependency patches. **Keep.** |
| `bun.lock` / `bunfig.toml` | Bun workspace files. **Keep** (regenerate lockfile after cleanup). |

### What to Delete (Already listed in Section 1)

- `packages/docs/`, `packages/web/`, `packages/enterprise/`, all `packages/console/*`, `packages/identity/`, `packages/function/`, `packages/extensions/` (if not using Zed).

---

## 7. Internal References to Update

After deletions, search remaining source code for these and update/remove:

1. `anomalyco/opencode` → your GitHub username/repo
2. `opencode.ai` → remove or replace
3. `opencode` (as project brand) → your project name
4. `security@anoma.ly` → remove
5. `discord.gg/opencode` / `opencode.ai/discord` → remove
6. `x.com/opencode` → remove
7. `https://github.com/anomalyco/opencode/security/advisories/new` → remove

**Also update** any hardcoded paths or workspace references that might break after package removals.

---

## 8. Files to Keep (But Review)

| File | Reason |
|------|--------|
| `AGENTS.md` | Coding style guide. **Keep the architectural rules** (Effect patterns, Drizzle naming, etc.). Only remove upstream branding references. |
| `.gitignore` | Still needed. Add `*.profraw` if not present. |
| `.vscode/` / `.zed/` | Editor settings. Keep if you use those editors. |
| `.husky/` | Git hooks. Keep. |
| `.editorconfig` | Editor config. Keep. |
| `.prettierignore` / `.oxlintrc.json` | Lint/format configs. Keep. |
| `turbo.json` | Turborepo config. Keep, but review for deleted package task references. |

---

## 9. Suggested Execution Order

1. **Create a backup branch:** `git checkout -b cleanup-backup` (or commit everything to `main` first). This is your revert point.
2. **Stop.** Read `packages/opencode/package.json` and confirm it does **not** reference any package you're about to delete via `workspace:*`.
3. Delete files/dirs from **Sections 1, 3, 4 (root script/), 5**.
4. **Edit root `package.json`** per Section 2 (remove workspaces, scripts, devDependencies, review dependencies, update repo URL).
5. Search-and-replace upstream brand names (Section 7).
6. **Purge stale state:** `rm -rf node_modules .turbo bun.lock`
7. **Regenerate lockfile:** `bun install`
8. Run `bun dev` (which launches `packages/opencode`) to verify the CLI still works.
9. Run `bun typecheck` from `packages/opencode/` to verify types.

---

## Key Safe-to-Delete vs. Keep-at-All-Costs Summary

| Safe to Delete | DO NOT DELETE |
|----------------|---------------|
| Root `script/` (public release automation) | `packages/opencode/script/` (local build scripts) |
| `packages/console/*/` (cloud billing/auth) | `packages/opencode/` (main CLI) |
| `packages/docs/`, `packages/web/`, `packages/enterprise/` | `packages/core/`, `packages/ui/`, `packages/app/` |
| `infra/`, `github/`, `.github/`, `nix/` | `patches/`, `bun.lock`, `bunfig.toml` |
| Root `install`, `flake.nix`, `flake.lock` | `turbo.json` (review first) |
| `packages/identity/` (branding assets only) | `packages/script/` (build tooling package) |
| `packages/function/` (cloud functions, no local refs) | `packages/plugin/` (used by core) |
| `packages/extensions/` (if you don't use Zed) | `packages/sdk/js/` (used by core) |
| `default.profraw`, `.DS_Store`, `.turbo/` | `AGENTS.md` (keep architecture rules) |
