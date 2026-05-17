# Permission System

## Overview

Not everything is "just prompt engineering." The permission system enforces hard constraints on tool usage regardless of what the prompt says.

## Permission Actions

```ts
export const Action = Schema.Literals(["allow", "deny", "ask"])
```

- `allow` — tool can be used freely
- `deny` — tool is blocked, throws a `PermissionDeniedError` if the agent tries to use it
- `ask` — tool requires user approval before execution

## Ruleset Structure

Permissions are arrays of rules:

```ts
export const Rule = Schema.Struct({
  permission: Schema.String,   // tool name or permission category
  pattern: Schema.String,      // glob/wildcard pattern
  action: Action,
})

export const Ruleset = Schema.mutable(Schema.Array(Rule))
```

## Default Rules (Per Agent)

Each agent starts with a default ruleset that can be merged with user config:

```ts
const defaults = Permission.fromConfig({
  "*": "allow",
  doom_loop: "ask",
  external_directory: { "*": "ask", ... },
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
  read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" },
})
```

## Evaluation

The `evaluate` function in `packages/opencode/src/permission/evaluate.ts` checks a permission request against all applicable rulesets in priority order. The ruleset order is:

1. Agent-specific merged rules
2. User-configured rules (`opencode.json` `permission` field)
3. Session-level approvals (user-clicked "always allow")

## Permission Events

```ts
export const Event = {
  Asked: BusEvent.define("permission.asked", Request),
  Replied: BusEvent.define("permission.replied", { sessionID, requestID, reply }),
}
```

When a tool call needs `ask`, the runtime:
1. Publishes a `permission.asked` event with the request
2. Waits for the user to reply via `permission.replied`
3. If approved once/always, the call proceeds
4. If rejected, throws `PermissionRejectedError` or `PermissionCorrectedError`

## Agent Capability Matrix

OpenAgent ships 14 native agents. Below is every agent, its mode, and which tools it can use.

### Primary Agents (User-Facing)

| Agent | Mode | Prompt | Key Permissions & Tools |
|-------|------|--------|------------------------|
| `build` | `primary` | Provider prompt only | Coding agent — all tools allowed; `question`, `plan_enter` allowed; **`task` allowed only for non-OpenAgent/default/custom subagents**; background/swarm orchestration **denied** |
| `assistant` | `primary` | Provider prompt + `assistant.txt` + OpenSwarm routing guidance | General-purpose non-coding agent — all tools allowed; `question`, `plan_enter` allowed; **`task` allowed**; **background task/graph, `send_message`, and `composio` allowed** |
| `plan` | `primary` | Provider prompt only (plan reminders injected by `session/prompt.ts`) | `edit: deny` except `.opencode/plans/*.md`; `question`, `plan_exit` allowed; **`task` denied**; background/swarm orchestration **denied** |

### Internal System Agents (Hidden)

| Agent | Mode | Prompt | Key Permissions & Tools |
|-------|------|--------|------------------------|
| `compaction` | `primary` (hidden) | `compaction.txt` | `* : deny` — only reads history |
| `title` | `primary` (hidden) | `title.txt` | `* : deny` — only generates titles |
| `summary` | `primary` (hidden) | `summary.txt` | `* : deny` — only generates summaries |

### Generic Subagents

| Agent | Mode | Prompt | Key Permissions & Tools |
|-------|------|--------|------------------------|
| `general` | `subagent` | Provider prompt only | `todowrite: deny`; **`task` denied**; all other normal tools allowed; can be a **`send_message` recipient** |
| `explore` | `subagent` | `explore.txt` | `* : deny` except `grep`, `glob`, `list`, `bash`, `webfetch`, `websearch`, `read`; **`task` denied** |

### OpenSwarm Specialist Subagents

| Agent | Mode | Prompt | Key Permissions & Tools |
|-------|------|--------|------------------------|
| `deep-research` | `subagent` | Generated (`agent.ts`) | `webfetch`, `websearch`, `deep_research: allow`; **`task` denied**; can be a `send_message` recipient |
| `data-analyst` | `subagent` | Generated (`agent.ts`) | `data_kernel: allow`; **`task` denied**; can be a `send_message` recipient |
| `slides-agent` | `subagent` | Generated (`agent.ts`) | `slides_plan`, `slides_modify`, `slides`, `slides_theme`, `slide_screenshot`, `slide_overflow_check: allow` (owner-gated); **`task` denied**; can be a `send_message` recipient |
| `docs-agent` | `subagent` | Generated (`agent.ts`) | `docs: allow`; **`task` denied**; can be a `send_message` recipient |
| `image-generation-agent` | `subagent` | Generated (`agent.ts`) | `image_generation: allow`; **`task` denied**; can be a `send_message` recipient |
| `video-generation-agent` | `subagent` | Generated (`agent.ts`) | `video_generation: allow`; **`task` denied**; can be a `send_message` recipient |

## Tool Access Gates

Three layers of registry gating control which agents receive which tools (`packages/opencode/src/tool/registry.ts`):

### 1. Blocking `task` — available to `build` and `assistant`

Only agents in `taskToolAgents` = `{"assistant", "build"}` receive the `task` tool. This lets them spawn subagent child sessions and wait for results.

Caller-aware spawn filtering in `packages/opencode/src/agent/spawnable.ts` keeps OpenAgent feature specialists assistant-only:

- `assistant` can see and spawn OpenAgent specialists such as `slides-agent`, `docs-agent`, and `deep-research`.
- `build` can see and spawn only non-OpenAgent/default/custom subagents such as `general`, `explore`, or project-defined coding/review agents.

**Denied for:** `plan`, `explore`, `general`, and all 6 OpenSwarm specialists.

### 2. Assistant-only orchestration — `assistant` only

The following tools only appear when `agent.name === "assistant"`:

- `background_task` / `background_task_list` / `background_task_get` / `background_task_cancel`
- `background_task_graph` / `background_task_graph_list` / `background_task_graph_get` / `background_task_graph_cancel`
- `send_message`

**Denied for:** `build`, `plan`, `explore`, `general`, all 6 OpenSwarm specialists, and blocked coordinator names (`orchestrator`).

### 3. Specialist owner-gated tools

These tools only appear for the agents listed in `openswarmToolOwners`:

| Tool ID | Owner Agent(s) |
|---------|----------------|
| `composio` | `assistant` |
| `deep_research` | `deep-research` |
| `data_kernel` | `data-analyst` |
| `slides_plan` | `slides-agent` |
| `slides_modify` | `slides-agent` |
| `slides` | `slides-agent` |
| `slides_theme` | `slides-agent` |
| `slide_screenshot` | `slides-agent` |
| `slide_overflow_check` | `slides-agent` |
| `docs` | `docs-agent` |
| `image_generation` | `image-generation-agent` |
| `video_generation` | `video-generation-agent` |

No other agent receives these tools, regardless of permission config.

### 4. Communication recipient filtering

`send_message` is additionally gated by configured communication flows (`packages/opencode/src/agent/communication.ts`). The tool only appears if at least one configured recipient exists for that agent+mode combination.

Default `send_message` recipients: `general`, `deep-research`, `data-analyst`, `slides-agent`, `docs-agent`, `image-generation-agent`, `video-generation-agent`.

## Blocked Spawn Names

The runtime refuses to spawn these names as subagents (`packages/opencode/src/agent/spawnable.ts`):

- `build`, `plan`, `assistant`, `chat`, `orchestrator`

## Key Takeaway

Use permissions and runtime config for hard guarantees — not prompt text. This is the enforcement layer for edit restrictions, bash restrictions, approval requirements, and tool availability.
