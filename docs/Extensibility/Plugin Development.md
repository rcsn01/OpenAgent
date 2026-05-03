# Plugin Development

This note is the practical “how do I ship a new capability and get chat to actually use it?” guide.

## 1. Decide Whether It Should Be A Plugin

A plugin is the right choice when you need:

- hooks
- auth or external services
- shell env injection
- plugin-provided custom tools
- behavior that spans more than a single callable function

If you only need one new action, a custom tool may be simpler.

## 2. Choose Where It Lives

There are three main placement options.

### Project-local

Use:

- `.opencode/plugins/`
- project `opencode.json`

This is best for repo-specific behavior.

### Global

Use:

- `~/.config/opencode/plugins/`
- global `opencode.json`

This is best for machine-wide behavior.

### Shared GUI Chat

Use:

- `Global.Path.config/chat/plugins/`
- `Global.Path.config/chat/opencode.json`

This is best when the feature should apply to **all GUI general chats** but not necessarily to repo-bound sessions.

For chat-specific features, this is usually the cleanest place.

## 3. Two Ways To Load A Plugin

### Auto-discovered local plugin file

Put a `.ts` or `.js` file in:

- `plugin/`
- `plugins/`

inside an active config directory.

OpenAgent scans `{plugin,plugins}/*.{ts,js}` and converts matching files into plugin specs.

This is the easiest way to prototype.

### Config-declared plugin package

Add a plugin spec to `opencode.json`:

```json
{
  "plugin": ["my-plugin-package"]
}
```

Use this when the plugin is published or when you want config-driven installation from npm.

## 4. Dependencies

If a local plugin or custom tool needs npm dependencies, put a `package.json` in the same config directory.

Examples:

- `.opencode/package.json`
- `~/.config/opencode/package.json`
- `~/.config/opencode/chat/package.json`

OpenAgent installs dependencies for config directories at startup, and plugin/tool loading waits for those dependencies before importing the files.

This is the mechanism that makes chat-wide plugin and tool bundles work without ad hoc manual installs.

## 5. Basic Plugin Shape

At minimum, a plugin exports a function that returns hooks.

If the plugin also wants to add callable tools, return them under the `tool` key.

The practical split is:

- hooks change runtime behavior
- plugin tools create new agent-callable capabilities

## 6. How Chat Actually Sees It

For GUI general chat, the path is:

1. The active directory is recognized as a general-chat workspace
2. `ConfigPaths.directories()` includes the shared chat config directory
3. Config loading scans that directory for config, plugins, and dependencies
4. Plugin loading imports any local plugin files or config-declared packages
5. `ToolRegistry` merges plugin-provided tools into the available tool set

That means a plugin can become chat-visible in either of these ways:

- it changes behavior through hooks
- it exposes one or more plugin tools

## 7. How To Get Chat To Use It Reliably

This is the part most likely to be missed.

Making a plugin **available** is not the same as making the model **choose** it.

To make chat use a new capability reliably:

1. Put the plugin where chat actually loads it
2. If the plugin exposes a tool, verify the tool name
3. Add or update a skill that tells chat when to use that capability
4. Add or update shared chat `AGENTS.md` if you need a stronger default

In practice:

- plugin/tool provides the capability
- skill/instruction provides the selection logic

If you skip step 3 or 4, the model may improvise with shell commands instead of using the feature you added.

## 8. Best Pattern For New Chat Capabilities

For most new GUI-chat features, the cleanest stack is:

1. Shared chat plugin or custom tool
2. Shared chat skill
3. Shared chat `AGENTS.md` guidance

That gives you:

- a real implementation path
- explicit model guidance about when to use it
- a single place to update behavior for all GUI chats

## 9. Example: Real `.docx` / `.pptx` Export

The direct Word/PowerPoint export work followed exactly this pattern.

The feature was implemented by:

- adding chat-wide export tools in the managed shared chat profile
- adding chat skills that explicitly tell the model to call those tools
- updating the shared chat instructions so the feature is framed as a first-class deliverable path

The important lesson is:

- without the tool, chat had to improvise
- without the skill, chat might still not choose the tool

Both layers were necessary.

## 10. When To Edit `GeneralChatProfile`

If you are just customizing your own setup, edit the shared chat directory directly.

If you want the capability to ship as a built-in default for managed chat profiles, edit:

```text
packages/opencode/src/general-chat/profile.ts
```

That is where the default shared chat files are seeded.

Use this path when you want future GUI chats to inherit the capability automatically.

## 11. Replication Checklist

When adding a new chat-wide capability:

1. Decide whether it is instruction-only, a skill, a custom tool, or a plugin
2. Put it in the shared chat profile if it should apply to all GUI chats
3. Add `package.json` if dependencies are needed
4. Verify plugin/tool naming
5. Add a skill so the model knows when to use it
6. Add `AGENTS.md` guidance if needed
7. Add or update tests for managed chat profile seeding
8. Run focused tests and typecheck

## Related Notes

- [[Extensibility/Implementing Features]] — choosing the right layer
- [[GUI Chat Mode/Shared Chat Profile]] — where chat-wide files live
- [[Prompt System/Skills]] — skill discovery and permissions
