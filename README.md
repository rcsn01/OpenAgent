# OpenAgent

OpenAgent is currently a frontend-only shell for the web app and Electron desktop wrapper.

The retained workspace packages are:

- `packages/app`: Solid/Vite application shell.
- `packages/ui`: shared UI components, contracts, and frontend utilities.
- `packages/desktop`: Electron host for native dialogs, storage, notifications, updates, titlebar controls, WSL path conversion, markdown parsing, and speech capture/transcription.

Backend, SDK, CLI/TUI, plugin, server, container, extension, and Storybook surfaces have been removed from this cleanup pass. Runtime-backed actions use a typed null runtime so the UI can render empty states until a new runtime integration is added.

## Development

```sh
bun install
bun run dev:web
bun run dev:desktop
```

## Verification

```sh
bun run lint
bun run typecheck
bun --cwd packages/ui test
bun --cwd packages/app test:unit
bun --cwd packages/app build
bun --cwd packages/desktop build
```
