# Primary Agents

OpenAgent currently ships 4 native primary agents that matter for day-to-day user flows:

- `build`
- `assistant`
- `chat`
- `plan`

These are registered in `packages/opencode/src/agent/agent.ts`.

## Quick Comparison

| Agent | Main purpose | Prompt behavior | Tool/capability difference | Default behavior |
|------|--------------|-----------------|----------------------------|------------------|
| `build` | Standard coding agent | Uses the provider prompt directly | Full normal toolset, can ask questions, can enter plan mode | Default outside hidden chat workspaces |
| `assistant` | Coding agent with stronger delegation workflows | Uses the provider prompt plus `packages/opencode/src/agent/prompt/assistant.txt` | Unlocks assistant-only background delegation tools | Selectable primary agent |
| `chat` | GUI general-chat agent | Uses the provider prompt plus `packages/opencode/src/agent/prompt/chat.txt` | Same baseline permissions as `build`, but tuned for broad conversations and artifact creation | Preferred default inside hidden chat workspaces |
| `plan` | Planning and analysis mode | Uses the provider prompt, plus plan reminders injected by `session/prompt.ts` | Edits are denied except plan files; `plan_exit` is allowed | Selectable primary agent |

## Build

`build` is the standard repo-work agent. It does not define a custom agent prompt, so runtime falls back to the provider prompt selected for the current model.

Important traits:

- Full normal tool access subject to the permission system
- `question` is allowed
- `plan_enter` is allowed
- No assistant-only background delegation tools

This is the default primary agent in normal workspaces.

## Assistant

`assistant` is closest to `build`, but with extra orchestration capabilities.

Important traits:

- Has `assistant_tools: true`
- Has `extend_provider_prompt: true`
- Adds `packages/opencode/src/agent/prompt/assistant.txt`
- Unlocks `background_task`, `background_task_graph`, and their management tools

This is the agent to use when the user explicitly wants delegation, parallel subagents, or staged background work.

## Chat

`chat` is a real built-in primary agent, not just a docs concept.

Important traits:

- Has `extend_provider_prompt: true`
- Adds `packages/opencode/src/agent/prompt/chat.txt`
- Shares the same baseline permission shape as `build`
- Is tuned for open-ended conversation, artifact creation, and hidden-workspace GUI chat flows

`chat` is hidden outside general-chat workspaces. Inside a hidden general-chat workspace, it becomes the preferred default primary agent.

## Plan

`plan` is the planning mode agent. It is not fully tool-less or read-only, but it does block normal file editing.

Important traits:

- `edit` is denied for normal project files
- Plan markdown files are the main edit exception
- `question` is allowed
- `plan_exit` is allowed
- `session/prompt.ts` injects planning workflow reminders when this agent is active

When `plan_exit` succeeds, the flow can switch the session back to `build` and inject a synthetic "execute the plan" message.

## What Actually Differs

There are 3 layers of difference between these agents:

1. Prompt selection
   - `build` and `plan` rely on the provider prompt.
   - `assistant` and `chat` keep the provider prompt and append their own agent prompt.

2. Tool exposure
   - `assistant` is the only one that gets the assistant-only background task tool family.
   - `plan` keeps non-edit tools but denies normal edits.

3. Workspace/context defaults
   - `build` is the normal default.
   - `chat` is preferred only in hidden general-chat workspaces.

## One Important Doc Drift

Some public docs still describe only `build` and `plan` as built-in primary agents. The runtime code is more current and clearly registers `build`, `assistant`, `chat`, and `plan` as native primary agents.

## Key Source Files

| File | Why it matters |
|------|----------------|
| `packages/opencode/src/agent/agent.ts` | Registers the 4 native primary agents, their prompts, options, permissions, and default selection behavior |
| `packages/opencode/src/tool/registry.ts` | Gates assistant-only background-task tools behind `assistant_tools: true` |
| `packages/opencode/src/session/llm.ts` | Decides whether to use provider prompt only or provider prompt plus agent prompt |
| `packages/opencode/src/session/prompt.ts` | Injects plan reminders and build-switch reminders |
| `packages/opencode/src/tool/plan.ts` | Implements `plan_exit` and the switch back to `build` |

## Related Notes

- [[Prompt System/Agent Prompts]] — how prompts are attached to agents
- [[Prompt System/Permission System]] — how hard tool constraints are enforced
- [[Prompt System/Prompt Assembly Flow]] — where these prompts/reminders are joined in runtime
- [[GUI Chat Mode/Index]] — how hidden chat workspaces affect the `chat` agent
