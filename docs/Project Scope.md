# Project Scope

This project is based off of [opencode](https://github.com/sst/opencode). All native opencode functionality is preserved as-is.

## Work Surfaces

New work is limited to two surfaces:

- **GUI side** — the Electron desktop app (`packages/desktop-electron/`) and the shared web UI (`packages/app/`)
- **Assistant Agent** — the `assistant` primary agent (`packages/openagent/src/agent/agent.ts`)

## Agent Separation

The `assistant` agent is the general-purpose coordinator — it handles research, delegation, specialist routing, background tasks, and all new capabilities. The `build` agent is kept strictly as the coding agent. This separation ensures coding workflows stay lean and predictable while new features grow through assistant.

## Assistant-Only Enforcement

Additional functionalities must be **assistant-only** and never exposed to `build`, `plan`, `general`, `explore`, or any OpenSwarm specialist subagent.

This is enforced through two layers:

1. **Permission system** — agent permission rulesets deny orchestration tools for non-assistant agents (`packages/openagent/src/agent/agent.ts`)
2. **Tool registry gating** — the `tools()` function in `packages/openagent/src/tool/registry.ts` filters tools per agent name
3. **Caller-aware spawn filtering** — `packages/openagent/src/agent/spawnable.ts` keeps OpenAgent specialist subagents visible/spawnable only to `assistant`; `build` keeps its opencode-style blocking `task` access for default/custom coding subagents

## Goal

Keep opencode as native as possible while layering new capabilities into the assistant agent.
