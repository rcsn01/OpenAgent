# Shared Chat Profile

The GUI chat system now has a **first-class shared config bundle** that applies across all general chats.

This is the main place to extend chat behavior globally without editing each hidden workspace by hand.

This profile is a configuration directory, not a native `chat` agent. The native `chat` agent has been removed; GUI general-chat sessions now default to `assistant`.

## Directory

The shared chat profile lives in:

```text
Global.Path.config/chat
```

In practice that is the app config directory plus a `chat/` subfolder.

The key code paths are:

- `packages/openagent/src/general-chat/profile.ts`
- `packages/openagent/src/config/paths.ts`
- `packages/openagent/src/session/instruction.ts`

## When It Applies

It is only included when the active session directory is recognized as a GUI general-chat workspace.

At that point the runtime:

1. Ensures the shared chat profile exists
2. Includes the shared `chat/` directory in config discovery
3. Adds the shared `chat/AGENTS.md` to system instructions
4. Scans the shared directory for skills, tools, plugins, and config files

## What You Can Put There

The shared chat profile can contribute all the usual extension layers:

- `AGENTS.md` — default chat instructions
- `skills/*/SKILL.md` — reusable chat workflows
- `tools/*.ts` or `tools/*.js` — custom callable tools
- `plugins/*.ts` or `plugins/*.js` — local auto-discovered plugins
- `openagent.json` or `openagent.jsonc` — config, permissions, plugin package list
- `package.json` — dependencies for local tools and plugins

This means the shared chat profile is effectively a dedicated “chat feature bundle”.

Because `assistant` is the default primary agent for GUI chats, shared profile tools and instructions are now layered onto `assistant` rather than a separate `chat` agent.

## Managed vs User-Managed

The directory supports two modes.

### Managed

If the profile contains:

```text
.openagent-chat-profile.json
```

then `GeneralChatProfile.ensureWith()` treats it as app-managed and seeds any missing default files.

That is how built-in chat-wide defaults are shipped.

### User-Managed

If the `chat/` directory exists **without** the marker file, OpenAgent leaves it alone.

This is the escape hatch if you want full manual control over the shared chat bundle.

## Current Example

The managed chat profile now seeds:

- `chat-documents`
- `chat-word-documents`
- `chat-presentations`
- `chat-powerpoint-presentations`
- `chat-spreadsheets`

It also seeds direct-export tools for:

- real `.docx` creation
- real `.pptx` creation

So the shared chat profile is already being used as the product’s chat-wide capability layer.

## How To Extend Chat Globally

Use the shared chat profile when you want every GUI chat to gain a new capability.

Typical workflow:

1. Add or update `AGENTS.md` if the change is mostly behavioral.
2. Add a skill when the capability needs a reusable workflow or strong selection hint.
3. Add a tool when the model needs a concrete action it can call.
4. Add a plugin when you need hooks, external integration, auth, or plugin-provided tools.
5. Add `package.json` if the tool or plugin needs npm dependencies.

## When To Edit Code Instead

Use the shared chat directory for local or power-user customization.

Edit `packages/openagent/src/general-chat/profile.ts` when you want the capability to become a built-in default that new managed chat profiles receive automatically.

That is the path to ship a chat feature in the product itself.

## Related Notes

- [[Desktop/Hidden Workspaces]] — the per-chat workspace layer
- [[Extensibility/Implementing Features]] — choose the right extension layer
- [[Extensibility/Plugin Development]] — add plugins and make chat use them
