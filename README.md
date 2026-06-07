# OpenAgent

OpenAgent is a GUI workspace for stock external opencode servers.

This repository owns the desktop shell, web app, shared UI components, and small GUI utilities. It does not vendor or patch the opencode runtime. Runtime behavior comes from an installed `opencode` CLI/server and the pinned `@opencode-ai/sdk` npm package.

## Workspace

- `packages/app` — Solid web GUI
- `packages/desktop` — Electron desktop wrapper
- `packages/ui` — shared UI components
- `packages/storybook` — UI component stories
- `packages/core` — slim shared GUI utility types/functions

## Development

Install dependencies:

```bash
bun install
```

Start a web UI with an external opencode server:

```bash
opencode server start --hostname 127.0.0.1 --port 4096
VITE_OPENCODE_SERVER_URL=http://127.0.0.1:4096 bun run --cwd packages/app dev
```

Start desktop against an existing server:

```bash
OPENAGENT_SERVER_URL=http://127.0.0.1:4096 bun run dev:desktop
```

Desktop can also start an installed external CLI with:

```bash
OPENCODE_BIN_PATH=/path/to/opencode bun run dev:desktop
```

`OPENCODE_DESKTOP_SERVER_URL` is accepted as a deprecated transition alias for `OPENAGENT_SERVER_URL`.

## Licensing

This repository is hosted publicly for educational and portfolio demonstration purposes only. See [LICENSE](./LICENSE).
