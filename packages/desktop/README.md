# @openagent/desktop

Electron desktop shell for the OpenAgent GUI.

The desktop app does not bundle an opencode runtime. Startup resolves a server in this order:

1. `OPENAGENT_SERVER_URL`
2. stored default server URL
3. `OPENCODE_BIN_PATH` or `opencode` on `PATH` via `opencode server start --json`
4. server selection/error UI

`OPENCODE_DESKTOP_SERVER_URL` remains as a deprecated alias for one transition release.

## Development

```bash
OPENAGENT_SERVER_URL=http://127.0.0.1:4096 bun run dev
```

## Build

```bash
bun run build
bun run package
```
