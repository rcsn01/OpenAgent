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

Run a stock opencode server separately:

```bash
opencode server start --hostname 127.0.0.1 --port 4096
```

Run web:

```bash
VITE_OPENCODE_SERVER_URL=http://127.0.0.1:4096 bun run --cwd packages/app dev
```

Run desktop:

```bash
OPENAGENT_SERVER_URL=http://127.0.0.1:4096 bun run --cwd packages/desktop dev
```

## Checks

```bash
bun run --cwd packages/core typecheck
bun run --cwd packages/ui typecheck
bun run --cwd packages/app typecheck
bun run --cwd packages/desktop typecheck
bun run --cwd packages/app test:unit
```
