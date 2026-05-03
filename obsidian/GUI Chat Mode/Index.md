# GUI Chat Mode

How the GUI-only `/chat` flow works internally.

General chats are not truly directory-less. They are backed by hidden workspaces under app data, then routed through a special `/chat/:id` URL layer so the hidden path is not exposed in the GUI.

## Contents

- [[GUI Chat Mode/Hidden Workspaces]] — where chat directories live, how they are allocated, and whether chat-only `AGENTS.md` or skills can be used
- [[GUI Chat Mode/Shared Chat Profile]] — the first-class shared config bundle for all GUI chats
- [[GUI Chat Mode/Session Switching Performance Implementation]] — full implementation history for seamless project/chat session switching, persistent UI shell, sidebar highlighting, and audio-toggle visibility
- [[GUI Chat Mode/Subagent Graph Panel and Prompt Updates]] — compact graph groups, completed graph retention, newest-first ordering, web tool guidance, and minimal subagent completion updates
- [[GUI Chat Mode/Project Sidebar Controls]] — expanded-sidebar project controls for compact/expanded sessions, organize/sort/show, and add project actions

## Key Source Files

| File | Role |
|------|------|
| `packages/opencode/src/general-chat/general-chat.ts` | Allocates hidden chat workspaces and maps them to root sessions |
| `packages/opencode/src/general-chat/shared.ts` | Defines `chatsRoot`, draft workspace behavior, and general-chat path detection |
| `packages/opencode/src/general-chat/profile.ts` | Seeds and repairs the shared chat profile used across all GUI chats |
| `packages/opencode/src/config/paths.ts` | Includes the shared chat profile in config discovery for general chats |
| `packages/app/src/context/app-route.tsx` | Resolves `/chat/:id` to the hidden backing directory |
| `packages/app/src/pages/session-route-host.tsx` | Keeps the normal session UI mounted while project/chat route state changes |
| `packages/app/src/context/general-chat-route-cache.ts` | Caches chat-to-directory route metadata so chat sessions can open without a blank resolve step |
| `packages/app/src/context/global-sync/child-store.ts` | Avoids eager hidden-directory bootstrap for lightweight session navigation |
| `packages/opencode/src/session/instruction.ts` | Loads `AGENTS.md` / `CLAUDE.md` relative to the hidden chat workspace |
| `packages/opencode/src/skill/index.ts` | Discovers project/global skills that may apply inside chat workspaces |
| `packages/app/src/pages/session/session-subagents-panel.tsx` | Renders compact/expandable subagent graph groups in the side panel |
| `packages/app/src/pages/session/session-subagents-panel-model.ts` | Builds graph groups, newest-first ordering, and default selection for the panel |
| `packages/opencode/src/session/task-graph.ts` | Retains completed graph records so child sessions keep their grouping |
| `packages/app/src/pages/layout/sidebar-hub.tsx` | Renders expanded-sidebar project controls and project/session list views |
