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

## Permission-Driven Agent Differences

Many built-in agents differ primarily through permissions rather than prompt text:

| Agent | Key Permissions |
|-------|----------------|
| `build` | Most tools allowed |
| `plan` | `edit: deny` for all paths except `.opencode/plans/*.md` |
| `general` | `todowrite: deny` |
| `explore` | `* : deny` except `grep`, `glob`, `list`, `bash`, `webfetch`, `websearch`, `read` |
| `assistant` | Same baseline as `build`, plus assistant-only delegation/OpenSwarm meta tools |
| `compaction` | `* : deny` (only reads history) |
| `title` | `* : deny` (only generates titles) |
| `summary` | `* : deny` (only generates summaries) |

Delegation and OpenSwarm meta tools are explicitly assistant-only:

- `task`
- `background_task`
- `background_task_*`
- `background_task_graph`
- `background_task_graph_*`
- `send_message`
- `transfer`

`build`, `plan`, `explore`, `general`, and the OpenSwarm specialists deny those tools even if their prompts ask for delegation.

## Key Takeaway

Use permissions and runtime config for hard guarantees — not prompt text. This is the enforcement layer for edit restrictions, bash restrictions, approval requirements, and tool availability.
