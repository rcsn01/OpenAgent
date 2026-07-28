# Local Development

OpenAgent owns the GUI and desktop shell. The opencode runtime runs externally.

## Packages

- `packages/app`: Solid web GUI
- `packages/desktop`: Electron desktop app
- `packages/ui`: shared UI
- `packages/storybook`: component stories
- `packages/core`: slim GUI utilities

## Setup

```bash
bun install
```

Run the Electron desktop app and a managed stock opencode server together:

```bash
bun run dev
```

Run the browser-only web app and a managed stock opencode server together:

```bash
bun run dev:web
```

The managed commands reuse a healthy server already listening on port `4096`.
When they start the server themselves, they stop it when the UI process exits.
To run the pieces independently:

```bash
bun run dev:server
bun run dev:desktop:shared
```

## Checks

```bash
bun run --cwd packages/core typecheck
bun run --cwd packages/ui typecheck
bun run --cwd packages/app typecheck
bun run --cwd packages/desktop typecheck
bun run --cwd packages/app test:unit
```
