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

## Key Source Files

| File | Role |
|------|------|
| `packages/opencode/src/config/paths.ts` | Determines which config directories apply, including the shared chat profile |
| `packages/opencode/src/general-chat/profile.ts` | Seeds the managed shared chat profile |
| `packages/opencode/src/skill/index.ts` | Discovers and filters skills |
| `packages/opencode/src/tool/registry.ts` | Discovers custom tools and plugin tools |
| `packages/opencode/src/config/plugin.ts` | Auto-discovers local plugin files |
| `packages/opencode/src/plugin/index.ts` | Loads plugins and waits for their dependencies |
| `packages/opencode/src/config/config.ts` | Installs dependencies for config directories and merges their config |
| `packages/opencode/src/session/instruction.ts` | Injects `AGENTS.md` and the shared chat profile instructions |
