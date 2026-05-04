# OpenAgent Extension System — Strategic Plan

## What we're building

A project-scoped extension system where each extension is a bundle of external tools (MCP) and behavioral instructions (skills). Inspired by Codex's plugin model, not opencode's.

## Core principles

**Project-scoped via existing opencode config**
Installing an extension on a project edits that project's `opencode.json` to register its MCP servers and copies the extension's skills into the project's `.opencode/skills/` folder. Extensions are not stored in a separate directory — they are first-class opencode config and skills. Opening "OpenSe" loads only OpenSe's extensions because only OpenSe's `opencode.json` references them.

**Extension = App + Skills**
An extension has two parts that always ship together:
- **App** — one or more MCP servers combined that connect to external services and expose actions
- **Skills** — behavioral instructions that teach the agent how and when to use those actions

Example: a Google Calendar extension ships with the Calendar MCP (14 actions) plus skills like "Daily Brief," "Meeting Prep," and "Group Scheduler."

**Coexists with the existing plugin system**
The opencode plugin system (TUI slot injection, theme loading, global config) stays as-is. Extensions are a separate concept that edits per-project opencode config and skills. No collision between the two.

**Marketplace registry ships with the app**
The list of available extensions is maintained as a static registry bundled into the app package itself. Only official extensions are included. There is no remote marketplace server, no automatic update check, and no support for custom or third-party registries. New extensions are released by updating the registry and shipping a new app version.

## What an extension does

- Connects to external services via MCP when the project opens
- Registers its tools into the agent's tool registry under a namespaced prefix
- Loads its skills into the prompt context so the agent knows how to use the tools
- Disconnects and unloads when the project closes or the extension is disabled

## Installation flow

User finds an extension in the marketplace or pastes an identifier. The extension package — which bundles its MCP servers and skills — is downloaded and installed into the current session's project by:

1. Editing the project's `opencode.json` to add the extension's MCP servers to the `mcp` list
2. Copying the extension's skill files into the project's `.opencode/skills/` folder

Disabling an extension removes its MCP entries from `opencode.json` and deletes its skills from `.opencode/skills/` without touching other config. Uninstalling does the same plus removes any cached extension data.

## How the agent uses it

When the user sends a prompt, the system checks which skills match the intent. Skills that came from extensions live in the same `.opencode/skills/` folder as user-defined skills — there is no separate loading path. If a skill from the Google Calendar extension triggers, its instructions are injected into the system prompt. The agent then knows it can call `google-calendar/fetch` or `google-calendar/create_event` and how to reason about the results.

## GUI changes

Extensions are managed through a dedicated panel in the right side panel area — alongside Review and Subagents — not in the left sidebar.

A new "Extensions" toggle button is added to the titlebar's right zone (next to the existing Review, Subagents, and File Tree toggles). Clicking it opens the Extensions panel in the right column, scoped to the current session's project. The panel shows installed extensions, their app actions, and their skills. Users can install new extensions from a marketplace search embedded in the panel itself.

The existing global plugin manager stays where it is in the left sidebar. Extensions and plugins are visually and spatially separated: plugins are global workspace tools on the left, extensions are project-scoped capabilities on the right.

## Server changes

Add new project-local routes for extensions, scoped to the current directory. Extension state lives in the project's local config. The existing `/experimental/plugins` routes stay untouched.

## Migration

No migration needed. The old plugin system remains fully operational. Extensions are a greenfield addition.

## Open questions

- How is authentication handled for external services?
- Can a skill reference tools from multiple extensions?
- Should skills hot-reload when edited?
