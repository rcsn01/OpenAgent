# OpenAgent

OpenAgent is a personal fork of the upstream AI coding agent workspace with the hosted console, public release plumbing, contributor governance, and marketing site removed.

## What Remains

- `packages/opencode`: main CLI and TUI runtime
- `packages/app`: local web UI used by desktop shells
- `packages/desktop` and `packages/desktop-electron`: desktop wrappers
- `packages/core`, `packages/ui`, `packages/plugin`, `packages/sdk`, and related shared libraries
- `sdks/vscode`: VS Code integration

## Local Development

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

## Running the GUI

To start the desktop GUI application in development mode:

```bash
bun run dev:desktop
```

This is equivalent to running `bun --cwd packages/desktop-electron dev` and starts the Electron shell with the local web UI.

## Packaging and Installing

To build the desktop application for distribution:

```bash
# Build the desktop app
cd packages/desktop-electron
bun run build

# Package for all platforms
bun run package

# Package for specific platforms
bun run package:mac
bun run package:win
bun run package:linux
```

Packaging uses `electron-builder` and produces installable artifacts (e.g., `.dmg` for macOS, `.exe` for Windows, `.AppImage`/`.deb` for Linux) in the `packages/desktop-electron/dist` directory.

## Repository

Project home and issue tracker:

- https://github.com/rcsn01/OpenAgent

This fork intentionally does not ship the upstream public docs site, release automation, hosted console, or enterprise surface.

## Knowledge Base

For detailed documentation on subsystems, see the relevant topics in this Obsidian vault:

- [[Prompt System/Index|Prompt System]] — how system prompts are assembled
- [[Voice Mode/Index|Voice Mode]] — hands-free dictation system
- [[Desktop/Index|Desktop]] — `/chat` flow internals
- [[Extensibility/Index|Extensibility]] — adding capabilities without core changes
- [[Architecture/Task Graph]] — DAG background task design
- [[Developer Guide/Coding Conventions]] — coding style and conventions
