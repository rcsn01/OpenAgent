# Hidden Workspaces

## Status Update

As of the current desktop GUI direction, standalone `/chat` session UX has been retired from the app shell and the user flow is now **project sessions only**.

That means:

- legacy `/chat` routes redirect back to home
- session creation and prompt submission happen through project workspaces only
- the sidebar no longer exposes separate chat-session browsing

The rest of this note is kept as historical/backend context for how hidden general-chat workspaces were implemented before the UI was simplified around project sessions.

## Short Answer

GUI general chats are **backed by hidden directories**. The GUI hides the path, but the backend still gives each chat a real workspace so existing file tools and session machinery continue to work.

## 1. Does each chat have its own hidden folder?

Yes, each **root general chat** gets its own hidden folder.

When a new general chat is created, `GeneralChat.create()` allocates a directory like:

```text
chats/
  chat-<timestamp>-<random>/
```

Source:

- `packages/openagent/src/general-chat/general-chat.ts`
- `packages/openagent/src/general-chat/shared.ts`

The important nuance is that this is per **root chat tree**, not per every child session.

- The `general_chat` table stores `session_id` + `directory`
- `session_id` is the **root session id**
- `get(sessionID)` walks upward through parents to the root session, then resolves the stored directory

So:

- one root GUI chat = one hidden workspace directory
- child sessions, forks, or follow-up sessions inside that chat tree reuse the same hidden directory

## Draft Chat Directory

Before the first message is submitted on `/chat`, there is a special draft token:

```text
__opencode_general_chat_draft__
```

That resolves to:

```text
chats/__draft__/
```

This gives the fresh `/chat` screen a temporary workspace before the real chat is created.

Once the first message creates a real general chat, the route must switch to the allocated hidden chat directory. If the URL keeps the draft token, the prompt can be sent to the real chat workspace while the GUI listens to the draft workspace, which makes the assistant reply look missing.

The app now:

- navigates new chats to `/chat/:sessionID?d=<hidden-chat-directory>`
- ignores the draft token for already-created `/chat/:sessionID` routes and resolves the real directory from cached/server chat metadata
- applies hidden-chat events even when the event directory matches the server-resolved path rather than the route/client path
- schedules a few forced chat syncs after send so replies still appear if an event is missed
- clears the busy state when a `session.error` event arrives, so failed hidden-chat prompts do not leave the composer looking permanently stuck

## Prompt Regression Fix

The remaining "user message appears, assistant never replies" failure was backend-side.

General chats run in hidden workspaces. If the active model/provider came from the current instance config, the newly allocated hidden workspace could start without that provider config. The prompt would save the user message, then fail model lookup before producing the assistant message.

The fix:

- `GeneralChat.create()` now snapshots the active config fields needed for prompting into the hidden chat workspace:
  - `provider`
  - `model`
  - `small_model`
  - provider enable/disable lists
  - agent/default-agent config
- A regression test creates a real general chat, switches into its hidden directory, sends a prompt, and asserts the assistant text is returned.
- A second regression test covers control-plane chat creation with no current instance context, so `/chat` can still create the session before any project/workspace context exists.

This keeps standalone GUI chats from losing model/provider visibility just because they are backed by an invisible workspace.

## 2. Where is the directory?

The root is:

```text
Global.Path.data/chats
```

In code:

```ts
export const chatsRoot = path.join(Global.Path.data, "chats")
```

On macOS, `Global.Path.data` is the app data directory for `opencode`, which is typically:

```text
~/Library/Application Support/opencode/chats/
```

So actual directories will look like:

```text
~/Library/Application Support/opencode/chats/__draft__/
~/Library/Application Support/opencode/chats/chat-macn3s2d-ab12cd34/
~/Library/Application Support/opencode/chats/chat-macn3s65-ef56gh78/
```

The GUI route does **not** expose these paths. `/chat/:id` resolves them internally through:

- `packages/app/src/context/app-route.tsx`
- `packages/app/src/pages/chat-layout.tsx`

## 3. Can GUI chats have their own `AGENTS.md`, custom agents, or skills?

Yes, but the scope matters.

### `AGENTS.md`

Yes. Because a general chat runs against a real hidden workspace directory, instruction loading works normally inside that workspace.

`Instruction.systemPaths()` searches upward from the current directory to the worktree root for:

- `AGENTS.md`
- `CLAUDE.md`
- `CONTEXT.md`

For a general chat, the hidden chat folder is effectively the worktree. That means a file like:

```text
~/Library/Application Support/opencode/chats/chat-.../AGENTS.md
```

can apply to that specific chat workspace.

### Custom agent markdown files

Also yes. Config agent loading scans:

```text
{agent,agents}/**/*.md
```

inside config directories. So a hidden chat workspace could carry agent definitions like:

```text
.openagent/agents/chat-specialist.md
agents/chat-specialist.md
```

inside that hidden directory tree.

### Skills

Also yes. Skill discovery scans project/global skill directories, including project-local external skill locations such as:

```text
.agents/skills/**/SKILL.md
.claude/skills/**/SKILL.md
```

and config-driven `skills.paths`.

That means a hidden chat workspace can have skills that only apply to that chat workspace if the skill files live inside that hidden directory tree.

## 4. Is there a shared config area for all GUI chats?

Yes. General chats now have a first-class shared chat profile in the global config area.

The directory is:

```text
Global.Path.config/chat
```

In code this comes from:

- `packages/openagent/src/config/paths.ts`
- `packages/openagent/src/general-chat/profile.ts`

When the current directory is a general-chat workspace:

- `ConfigPaths.directories()` includes the shared `chat/` directory in config discovery
- `Instruction.systemPaths()` adds `Global.Path.config/chat/AGENTS.md` to system instructions
- normal config scanning then picks up shared chat `skills/`, `tools/`, `plugins/`, and `openagent.json`

So there are **two layers** now:

- Per-chat hidden workspace customization
- Shared GUI-chat customization for all chats

## Managed vs User-Managed

The shared chat directory can be either:

- **Managed** — seeded and repaired automatically by `GeneralChatProfile.ensureWith()`
- **User-managed** — if the directory exists without the management marker file, OpenAgent leaves it alone

The marker file is:

```text
.openagent-chat-profile.json
```

This lets the app ship default chat behavior while still allowing power users to take full ownership of the shared chat config area.

## Updated Practical Implication

If you want chat-only behavior across **all** GUI chats, you do not need to modify each hidden workspace manually anymore.

Use the shared chat profile instead.

Use per-chat hidden workspace files only when you want one specific chat tree to behave differently from the global chat defaults.

So the practical split is:

- Yes: one specific chat can still have its own hidden-workspace `AGENTS.md`, agents, and skills
- Yes: all GUI chats can now share one dedicated chat config bundle
- No: hidden workspaces are still not the same thing as the shared chat profile; they are separate layers

## Better Mental Model

Think of GUI general chats as:

```text
special route
+ hidden workspace
+ shared chat profile
+ normal session engine
```

They look directory-less in the app, but internally they now combine:

- an invisible per-chat workspace
- a shared GUI-chat config bundle
- the ordinary session/config/tool/plugin engine

## Related Notes

- [[Desktop/Shared Chat Profile]] — how the shared chat bundle is seeded and extended
- [[Extensibility/Plugin Development]] — how to add plugins/tools that chat can actually use
