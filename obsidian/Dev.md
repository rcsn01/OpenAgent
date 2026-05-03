# OpenAgent

OpenAgent is a personal fork of the upstream AI coding agent workspace with the hosted console, public release plumbing, contributor governance, and marketing site removed.

## What remains

- `packages/opencode`: main CLI and TUI runtime
- `packages/app`: local web UI used by desktop shells
- `packages/desktop` and `packages/desktop-electron`: desktop wrappers
- `packages/core`, `packages/ui`, `packages/plugin`, `packages/sdk`, and related shared libraries
- `sdks/vscode`: VS Code integration

## Local development

```bash
bun install
bun dev
```

Core validation commands:

```bash
bun run --cwd packages/opencode test
bun run --cwd packages/opencode typecheck
```

Additional local entry points:

```bash
bun --cwd packages/app dev
bun --cwd packages/desktop-electron dev
```

## Repository

Project home and issue tracker:

- https://github.com/rcsn01/OpenAgent

This fork intentionally does not ship the upstream public docs site, release automation, hosted console, or enterprise surface.
