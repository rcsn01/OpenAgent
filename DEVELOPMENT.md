# Development

This guide covers the practical workflows for using this repo as a local OpenCode build:

- run it directly from source
- build a standalone local binary
- install that local binary on your machine as `openagent`
- revert back to the official release
- merge new upstream OpenCode updates into this fork

For broader contributor guidance, see `CONTRIBUTING.md`.

## Requirements

- Bun 1.3+
- Run commands from the repo root unless noted otherwise

Install dependencies first:

```bash
bun install
```

## Run The Local Version From Source

During development, `bun dev` is the local equivalent of the installed `openagent` command.

Start the TUI:

```bash
bun dev
```

Useful variants:

```bash
bun dev .
bun dev --help
bun dev serve
bun dev web
```

Notes:

- `bun dev` runs OpenCode in `packages/opencode` by default.
- `bun dev .` runs OpenCode against this repo root.
- Running from source does not replace any separately installed `opencode` binary.

## Build A Standalone Local Binary

To build a standalone executable for your current platform:

```bash
./packages/opencode/script/build.ts --single
```

This writes a platform-specific binary to:

```bash
./packages/opencode/dist/openagent-<platform>/bin/openagent
```

Examples:

- `./packages/opencode/dist/openagent-darwin-arm64/bin/openagent`
- `./packages/opencode/dist/openagent-darwin-x64/bin/openagent`
- `./packages/opencode/dist/openagent-linux-x64/bin/openagent`

Run the built binary directly:

```bash
./packages/opencode/dist/openagent-<platform>/bin/openagent --help
```

### Direct binary usage examples

Replace `<platform>` with your actual platform folder (e.g. `darwin-arm64`).

Show the version:

```bash
./packages/opencode/dist/openagent-darwin-arm64/bin/openagent --version
```

Start the TUI in the current directory:

```bash
./packages/opencode/dist/openagent-darwin-arm64/bin/openagent
```

Start the TUI in a specific project:

```bash
./packages/opencode/dist/openagent-darwin-arm64/bin/openagent /path/to/project
```

Start the headless API server:

```bash
./packages/opencode/dist/openagent-darwin-arm64/bin/openagent serve
```

Start the web interface:

```bash
./packages/opencode/dist/openagent-darwin-arm64/bin/openagent web
```

> **Tip:** You can copy or symlink the binary anywhere you want (e.g. `~/bin/openagent`) and run it from there without using the `./install` script.

## Install The Local Build On Your Machine

The supported way to install a local development build is to use the repo's installer with `--binary`.

The built binary is now also named `openagent`, so the direct-run path and the installed command match.

1. Build the binary:

```bash
./packages/opencode/script/build.ts --single
```

2. Install that binary:

```bash
./install --binary ./packages/opencode/dist/openagent-<platform>/bin/openagent
./install --binary ./packages/opencode/dist/openagent-darwin-arm64/bin/openagent
```

What this does:

- copies the binary to `~/.openagent/bin/openagent`
- makes it executable
- updates your shell config to put `~/.openagent/bin` on your `PATH` when needed

Verify the installed command:

```bash
openagent --version
which openagent
```

If you only want to try the build without installing it, skip `./install` and run the binary directly from `./packages/opencode/dist/...`.

## Revert Back To The Official Release

If you no longer want to use your local development build, the simplest rollback is to reinstall the official release:

```bash
./install
```

That downloads the latest release from `anomalyco/opencode` and installs it as `openagent` in `~/.openagent/bin/openagent`.

If you want a specific official version instead of the latest one:

```bash
./install --version 1.14.25
```

If you want to stop using the installer-managed copy entirely and fall back to another installation method such as Homebrew or npm:

```bash
rm -f ~/.openagent/bin/openagent
```

Then either:

- open a new shell so your other `opencode` installation is found first, or
- remove the `~/.openagent/bin` PATH entry that `./install` added to your shell config if you no longer want to use that location at all

## Merge New OpenCode Updates Into This Repo

This fork uses:

- `origin` for your fork
- `upstream` for `https://github.com/anomalyco/opencode.git`
- `dev` as the default branch

OpenCode upstream uses `dev`, not `main`, for the primary branch.

### One-Time Remote Setup

If `upstream` is not configured yet:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
```

Verify your remotes:

```bash
git remote -v
```

### Safe Merge Workflow

Before merging, make sure your working tree is clean or your changes are committed/stashed.

```bash
git status
git fetch upstream origin
git checkout dev
git pull --ff-only origin dev
git checkout -b merge-upstream-YYYY-MM-DD
git merge upstream/dev
```

If there are conflicts:

1. Resolve them in the files Git reports.
2. Mark them resolved with `git add <file>`.
3. Finish the merge with `git commit`.

After the merge, run a focused verification step for the packages you touched. For example:

```bash
cd packages/opencode
bun typecheck
```

Then push the branch and open a PR back into `dev` on your fork:

```bash
git push origin merge-upstream-YYYY-MM-DD
```

### Fast-Forward Case

If your `dev` branch has no local commits beyond upstream and you just want to bring it up to date, you can update it directly:

```bash
git fetch upstream
git checkout dev
git merge --ff-only upstream/dev
git push origin dev
```

Use the fast-forward path only when your local `dev` has not diverged from upstream. Otherwise, use the merge-branch workflow above.