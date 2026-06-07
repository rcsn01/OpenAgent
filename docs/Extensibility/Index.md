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
- [[Architecture/external orchestration Integration]] — per-user integration auth, specialist-owned tools, and assistant-only routing

## Key Source Files

| File | Role |
|------|------|
| `external opencode runtime/src/config/paths.ts` | Determines which config directories apply, including the shared chat profile |
| `external opencode runtime/src/general-chat/profile.ts` | Seeds the managed shared chat profile |
| `external opencode runtime/src/skill/index.ts` | Discovers and filters skills |
| `external opencode runtime/src/tool/registry.ts` | Discovers custom tools and plugin tools |
| `external opencode runtime/src/config/plugin.ts` | Auto-discovers local plugin files |
| `external opencode runtime/src/plugin/index.ts` | Loads plugins and waits for their dependencies |
| `external opencode runtime/src/extension/index.ts` | Installs, removes, lists, and live-reloads project-scoped extensions |
| `packages/app/src/extensions/registry.ts` | Bundles official extension marketplace entries in the app |
| `packages/app/src/pages/session/side-panel/extensions/index.tsx` | Renders the project-scoped Extensions side panel |
| `external opencode runtime/src/config/config.ts` | Installs dependencies for config directories and merges their config |
| `external opencode runtime/src/session/instruction.ts` | Injects `AGENTS.md` and the shared chat profile instructions |
| `external opencode runtime/src/integration/auth.ts` | Stores per-user integration credentials for specialist tools |
| `external opencode runtime/src/server/routes/instance/integration.ts` | Exposes integration OAuth/status APIs |
