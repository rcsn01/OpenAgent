# OpenCode Desktop

Native OpenCode desktop app, built with Electron.

## Development

From the repo root:

```bash
bun install
bun run dev:desktop
```

This starts the Electron shell with the local web UI.

If you only want the web dev server (no native shell):

```bash
bun run dev:web
```

## Build

To create a production `dist/` and build the native app bundle:

```bash
bun --cwd packages/desktop-electron build
bun --cwd packages/desktop-electron package
```

## Prerequisites

Running the desktop app requires the Electron dependencies installed by the workspace package manager.
