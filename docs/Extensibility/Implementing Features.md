# Implementing Features

When you add a new capability to OpenAgent, the most important choice is **which extension layer owns it**.

Not every feature should be a plugin.

## Mental Model

Use the smallest layer that can actually solve the problem:

1. Instructions
2. Skills
3. Custom tools
4. Plugins
5. Built-in product code

Each layer is progressively more powerful and more expensive to maintain.

## 1. Instructions

Use instructions when the model already has the capability and mostly needs better defaults.

Examples:

- preferred formatting
- repo conventions
- when to ask questions
- when to prefer one existing tool over another

Places this can live:

- `AGENTS.md`
- shared chat `AGENTS.md`
- `instructions` entries in config

This is the lightest-weight option, but it cannot create new hard capabilities.

## 2. Skills

Use a skill when the model needs a reusable workflow, not just a preference.

Examples:

- “When asked for a memo, draft Markdown first, then export”
- “For deck work, produce a slide spec before rendering”
- “For code review, follow this specific checklist”

Skills are especially useful when:

- tool availability already exists
- the model needs a strong hint about when to use it
- you want consistent multi-step behavior

If a capability exists but the model is not choosing it reliably, a skill is often the missing layer.

## 3. Custom Tools

Use a custom tool when the model needs to perform a concrete action it could not do before.

Examples:

- export Markdown to `.docx`
- build a `.pptx` from a slide spec
- call an internal API
- transform a domain-specific file format

Custom tools are loaded from `tool/` or `tools/` directories in the active config directories.

Important naming rule:

- A default export uses the filename as the tool name
- A named export uses `<filename>_<exportname>`

So:

- `tools/documents.ts` + `export const create_docx = ...`
- becomes `documents_create_docx`

That naming detail matters when writing skills or instructions that refer to the tool.

## 4. Plugins

Use a plugin when you need more than a callable function.

Plugins are the right layer for:

- external service integrations
- auth flows
- event hooks
- shell env injection
- permission-side behavior
- plugin-provided custom tools

If the feature needs to react to runtime events or change behavior across multiple subsystems, it probably belongs in a plugin.

## 5. Built-In Product Code

Change core code when the feature should become a product default for everyone.

Examples:

- new built-in agents
- new built-in chat profile defaults
- shipping default shared chat skills/tools
- changing config-directory behavior itself

This is the heaviest option, but it is the right one when the capability should not depend on local customization.

## Decision Guide

Use this quick rule of thumb:

- “I only need better default behavior” → instructions
- “I need a reusable workflow” → skill
- “I need a new action” → custom tool
- “I need hooks/integration/runtime wiring” → plugin
- “This should ship as a product default” → built-in code

## GUI Chat-Specific Features

For general GUI chat, there is a special extra layer: the shared chat profile.

That profile can contain:

- chat-wide instructions
- chat-only skills
- chat-only custom tools
- chat-only plugins
- its own `package.json`

So for chat-specific features, the first question is:

“Should this apply to one chat workspace, all GUI chats on this machine, or all users of the product?”

That maps to:

- one hidden workspace
- the shared chat profile
- built-in source code

## Practical Workflow

A low-friction implementation loop usually looks like this:

1. Start with a skill if the capability is mostly workflow.
2. Add a custom tool if the model still lacks the action itself.
3. Add or update a plugin if the tool needs external integration or hooks.
4. Add instructions so the model knows when to use the new capability.
5. If the feature should ship by default, move the files into built-in seeding code.

## Common Failure Modes

The most common reasons a feature “exists” but chat still does not use it are:

- the capability is in a tool, but no skill or instruction tells the model when to pick it
- the capability is in a plugin or tool, but it is not inside a directory the active session scans
- dependencies were added, but no `package.json` exists in the relevant config directory
- the tool name the skill refers to does not match the real generated tool id
- the feature was added to one hidden chat workspace, but the user expected it across all GUI chats

## Related Notes

- [[Extensibility/Plugin Development]] — plugin-specific process
- [[Desktop/Shared Chat Profile]] — where to place chat-wide extensions
- [[Prompt System/Skills]] — how skills are discovered and filtered
