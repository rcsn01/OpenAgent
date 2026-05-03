# Hidden Workspaces

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

- `packages/opencode/src/general-chat/general-chat.ts`
- `packages/opencode/src/general-chat/shared.ts`

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
.opencode/agents/chat-specialist.md
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

- `packages/opencode/src/config/paths.ts`
- `packages/opencode/src/general-chat/profile.ts`

When the current directory is a general-chat workspace:

- `ConfigPaths.directories()` includes the shared `chat/` directory in config discovery
- `Instruction.systemPaths()` adds `Global.Path.config/chat/AGENTS.md` to system instructions
- normal config scanning then picks up shared chat `skills/`, `tools/`, `plugins/`, and `opencode.json`

So there are **two layers** now:

- Per-chat hidden workspace customization
- Shared GUI-chat customization for all chats

## Managed vs User-Managed

The shared chat directory can be either:

- **Managed** — seeded and repaired automatically by `GeneralChatProfile.ensureWith()`
- **User-managed** — if the directory exists without the management marker file, OpenAgent leaves it alone

The marker file is:

```text
.opencode-chat-profile.json
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

- [[GUI Chat Mode/Shared Chat Profile]] — how the shared chat bundle is seeded and extended
- [[Extensibility/Plugin Development]] — how to add plugins/tools that chat can actually use
