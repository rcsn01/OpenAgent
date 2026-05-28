# Extensibility

How OpenAgent gains new capabilities without changing the whole core each time.

This section is about the practical extension mechanisms:

- instructions
- skills
- custom tools
- plugins
- the shared GUI chat profile

## Contents

- [[Extensibility/Implementing Features]] — choose the right layer for a new feature
- [[Extensibility/Plugin Development]] — create a plugin and get chat to use it
- [[Extensibility/Project-Scoped Extensions]] — add an official app-bundled extension with MCP servers, skills, install UI, OAuth, and tests
- [[Architecture/OpenSwarm Integration]] — per-user integration auth, specialist-owned tools, and assistant-only routing

## Key Source Files

| File | Role |
|------|------|
| `packages/openagent/src/config/paths.ts` | Determines which config directories apply, including the shared chat profile |
| `packages/openagent/src/general-chat/profile.ts` | Seeds the managed shared chat profile |
| `packages/openagent/src/skill/index.ts` | Discovers and filters skills |
| `packages/openagent/src/tool/registry.ts` | Discovers custom tools and plugin tools |
| `packages/openagent/src/config/plugin.ts` | Auto-discovers local plugin files |
| `packages/openagent/src/plugin/index.ts` | Loads plugins and waits for their dependencies |
| `packages/openagent/src/extension/index.ts` | Installs, removes, lists, and live-reloads project-scoped extensions |
| `packages/app/src/extensions/registry.ts` | Bundles official extension marketplace entries in the app |
| `packages/app/src/pages/session/side-panel/extensions/index.tsx` | Renders the project-scoped Extensions side panel |
| `packages/openagent/src/config/config.ts` | Installs dependencies for config directories and merges their config |
| `packages/openagent/src/session/instruction.ts` | Injects `AGENTS.md` and the shared chat profile instructions |
| `packages/openagent/src/integration/auth.ts` | Stores per-user integration credentials for specialist tools |
| `packages/openagent/src/server/routes/instance/integration.ts` | Exposes integration OAuth/status APIs |
