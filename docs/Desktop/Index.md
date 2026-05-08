# Desktop

How the Electron and Tauri desktop applications work, including the GUI chat experience.

The desktop apps wrap the shared web UI (`@opencode-ai/app`) and provide platform-specific glue: native dialogs, IPC, auto-update, speech capture, and sidecar server management.

General chats are not truly directory-less. They are backed by hidden workspaces under app data, then routed through a special `/chat/:id` URL layer so the hidden path is not exposed in the GUI.

The native `chat` agent has been removed. Hidden general-chat workspaces now use `assistant` as their preferred primary agent, while the shared `chat/` profile directory remains the place for GUI-chat-wide config, tools, skills, and instructions.

## Contents

- [[Desktop/Hidden Workspaces]] — where chat directories live, how they are allocated, and whether chat-only `AGENTS.md` or skills can be used
- [[Desktop/Shared Chat Profile]] — the first-class shared config bundle for all GUI chats
- [[Desktop/Session Switching]] — implementation history for seamless project/chat session switching, persistent UI shell, sidebar highlighting, and audio-toggle visibility
- [[Desktop/Subagent Graph Panel and Prompt Updates]] — compact graph groups, completed graph retention, newest-first ordering, web tool guidance, and minimal subagent completion updates
- [[Desktop/Project Sidebar Controls]] — expanded-sidebar project controls for compact/expanded sessions, organize/sort/show, and add project actions

## Key Source Files

| File | Role |
|------|------|
| `packages/desktop-electron/src/main/` | Electron main process: window management, IPC, menus |
| `packages/desktop-electron/src/preload/` | Electron preload: `window.api` bridge to renderer |
| `packages/desktop-electron/src/renderer/` | Electron renderer: SolidJS entry point, platform glue |
| `packages/desktop/src/` | Tauri desktop renderer entry point |
| `packages/desktop/src-tauri/` | Tauri Rust backend |
| `packages/app/src/` | Shared web UI imported by both desktop targets |
| `packages/opencode/src/general-chat/general-chat.ts` | Allocates hidden chat workspaces and maps them to root sessions |
| `packages/opencode/src/general-chat/shared.ts` | Chat root, draft workspace behavior, general-chat path detection |
| `packages/opencode/src/general-chat/profile.ts` | Seeds and repairs the shared chat profile |
| `packages/app/src/context/app-route.tsx` | Resolves `/chat/:id` to the hidden backing directory |
| `packages/app/src/pages/session-route-host.tsx` | Persistent session shell mounted across route changes |
| `packages/app/src/context/general-chat-route-cache.ts` | Caches chat-to-directory route metadata |
| `packages/app/src/pages/session/side-panel/subagents/index.tsx` | Subagent graph panel UI |
| `packages/app/src/pages/layout/sidebar-hub.tsx` | Expanded sidebar with project controls |

## Related

- [[Agents/Index]] — agent capability matrix; assistant is the default for chat workspaces
- [[Architecture/OpenSwarm Integration]] — native specialist routing and per-user OAuth
