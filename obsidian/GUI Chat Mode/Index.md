# GUI Chat Mode

How the GUI-only `/chat` flow works internally.

General chats are not truly directory-less. They are backed by hidden workspaces under app data, then routed through a special `/chat/:id` URL layer so the hidden path is not exposed in the GUI.

## Contents

- [[GUI Chat Mode/Hidden Workspaces]] — where chat directories live, how they are allocated, and whether chat-only `AGENTS.md` or skills can be used
- [[GUI Chat Mode/Shared Chat Profile]] — the first-class shared config bundle for all GUI chats

## Key Source Files

| File | Role |
|------|------|
| `packages/opencode/src/general-chat/general-chat.ts` | Allocates hidden chat workspaces and maps them to root sessions |
| `packages/opencode/src/general-chat/shared.ts` | Defines `chatsRoot`, draft workspace behavior, and general-chat path detection |
| `packages/opencode/src/general-chat/profile.ts` | Seeds and repairs the shared chat profile used across all GUI chats |
| `packages/opencode/src/config/paths.ts` | Includes the shared chat profile in config discovery for general chats |
| `packages/app/src/context/app-route.tsx` | Resolves `/chat/:id` to the hidden backing directory |
| `packages/app/src/pages/chat-layout.tsx` | Reuses the normal session UI against the hidden directory |
| `packages/opencode/src/session/instruction.ts` | Loads `AGENTS.md` / `CLAUDE.md` relative to the hidden chat workspace |
| `packages/opencode/src/skill/index.ts` | Discovers project/global skills that may apply inside chat workspaces |
