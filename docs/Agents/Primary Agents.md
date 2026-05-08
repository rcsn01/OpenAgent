# Primary Agents

OpenAgent currently ships 3 native user-facing primary agents:

- `build`
- `assistant`
- `plan`

There is no native `chat` primary agent. GUI general-chat workspaces now default to `assistant`.

These agents are registered in `packages/opencode/src/agent/agent.ts`.

## Quick Comparison

| Agent | Main purpose | Prompt behavior | Tool/capability difference | Default behavior |
|------|--------------|-----------------|----------------------------|------------------|
| `build` | Coding agent — code generation, editing, refactoring, debugging | Uses the provider prompt directly | Full normal toolset; can ask questions; can enter plan mode; **blocking `task` allowed**; background/swarm tools denied | Default outside hidden chat workspaces |
| `assistant` | General-purpose non-coding agent — research, delegation, specialist routing, background work, all new capabilities | Uses the provider prompt plus `assistant.txt` and native OpenSwarm routing guidance | **Blocking `task` allowed** plus assistant-only background tasks, task graphs, `send_message`, and `transfer` | Default inside hidden general-chat workspaces; selectable elsewhere |
| `plan` | Planning and analysis mode | Uses the provider prompt, plus plan reminders injected by `session/prompt.ts` | Edits denied except `.opencode/plans/*.md`; `plan_exit` allowed; **`task` denied**; all swarm tools denied | Selectable primary agent |

## Build

`build` is the coding agent. It is purpose-built for code generation, editing, refactoring, debugging, and all implementation work. It does not define a custom agent prompt, so the runtime falls back to the provider prompt selected for the current model.

Important traits:

- Full normal tool access subject to the permission system
- `question` is allowed
- `plan_enter` is allowed
- Blocking `task` is allowed for synchronous subagent work
- Background tasks, graph tasks, `send_message`, and `transfer` are denied

This is the default primary agent in normal workspaces.

## Assistant

`assistant` is the general-purpose non-coding agent. It owns research, delegation, specialist routing, background work, and all new capabilities. It should not be used for direct code generation or editing — that belongs to `build`.

Important traits:

- Has `assistant_tools: true`
- Has `extend_provider_prompt: true`
- Adds `packages/opencode/src/agent/prompt/assistant.txt`
- Adds native OpenSwarm routing guidance
- Unlocks `task`, `background_task`, `background_task_graph`, their management tools, `send_message`, and `transfer`
- Can use `send_message` with existing `general` and OpenSwarm specialist child sessions by default
- Must create the needed child session with `task` before `send_message` if none exists
- Can spawn registered specialist subagents by exact name:
  - `virtual-assistant`, `deep-research`, `data-analyst`, `slides-agent`, `docs-agent`, `image-generation-agent`, `video-generation-agent`
  - `general`, `explore`
- Cannot spawn `build`, `plan`, `assistant`, `chat`, or `orchestrator`
- Default `send_message` recipients: `general` + all 7 specialists
- Default `transfer` recipients: 7 specialists only (excludes `general`)

Use `assistant` when the user wants delegation, parallel specialist work, background work, or a GUI general-chat session.

## Plan

`plan` is the planning mode agent. It is not fully tool-less or read-only, but it does block normal file editing.

Important traits:

- `edit` is denied for normal project files
- Plan markdown files are the main edit exception
- `question` is allowed
- `plan_exit` is allowed
- Delegation and OpenSwarm meta tools are denied
- `session/prompt.ts` injects planning workflow reminders when this agent is active

When `plan_exit` succeeds, the flow can switch the session back to `build` and inject a synthetic "execute the plan" message.

## General Chat Workspaces

General-chat workspaces are still real hidden workspaces, and the shared `chat/` config profile still exists. That profile can provide instructions, skills, tools, plugins, and config for GUI chats.

The important distinction:

- `chat/` profile directory: still exists
- native `chat` agent: removed

Inside a hidden general-chat workspace, the preferred primary agent is now `assistant`.

## What Actually Differs

There are 3 layers of difference between these agents:

1. Prompt selection
   - `build` and `plan` rely on the provider prompt.
   - `assistant` keeps the provider prompt and appends its own agent prompt plus native specialist-routing guidance.

2. Tool exposure
   - `build` and `assistant` get the blocking `task` tool.
   - `assistant` is the only one that gets background task, graph task, `send_message`, and `transfer`.
   - `plan` explicitly denies those tools.
   - `plan` also denies normal edits.

3. Workspace/context defaults
   - `build` is the normal workspace default.
   - `assistant` is preferred in hidden general-chat workspaces.

## Key Source Files

| File | Why it matters |
|------|----------------|
| `packages/opencode/src/agent/agent.ts` | Registers native primary agents, specialist subagents, prompts, options, permissions, and default selection behavior |
| `packages/opencode/src/agent/spawnable.ts` | Blocks primary/removed coordinator names from subagent spawning |
| `packages/opencode/src/tool/registry.ts` | Gates build/assistant `task`, assistant-only orchestration, and specialist-owned tools |
| `packages/opencode/src/session/llm.ts` | Decides whether to use provider prompt only or provider prompt plus agent prompt |
| `packages/opencode/src/session/prompt.ts` | Injects plan reminders and build-switch reminders |
| `packages/opencode/src/tool/plan.ts` | Implements `plan_exit` and the switch back to `build` |

## Related Notes

- [[Architecture/OpenSwarm Integration]] — specialist routing, `send_message`, `transfer`, OAuth, and artifact tools
- [[Prompt System/Agent Prompts]] — how prompts are attached to agents
- [[Agents/Permission System]] — how hard tool constraints are enforced
- [[Prompt System/Prompt Assembly Flow]] — where these prompts/reminders are joined in runtime
- [[Desktop/Index]] — how hidden chat workspaces now default to `assistant`
