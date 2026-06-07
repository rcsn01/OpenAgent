# @openagent/app

Solid web GUI for external opencode servers.

## Development

Run an opencode server separately, then start Vite:

```bash
opencode server start --hostname 127.0.0.1 --port 4096
VITE_OPENCODE_SERVER_URL=http://127.0.0.1:4096 bun run dev
```

## Checks

```bash
bun run typecheck
bun run test:unit
```
