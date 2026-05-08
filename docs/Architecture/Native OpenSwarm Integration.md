# Native OpenSwarm Integration

OpenAgent implements the OpenSwarm-style routing model natively in the TypeScript runtime. It does not vendor Agency Swarm or run OpenSwarm as a Python sidecar.

The current design has one coordinator: the native `assistant` agent. The separate `orchestrator` agent was removed and its routing behavior was merged into `assistant`.

## Current Shape

The system has three layers:

1. Primary user-facing agents
2. Spawnable specialist subagents
3. Assistant-only orchestration tools

Only `assistant` can coordinate other agents. Other primary agents and specialists cannot call delegation or swarm tools.

## Primary Agents

| Agent | Mode | Role |
|-------|------|------|
| `build` | `primary` | Standard coding and implementation agent |
| `assistant` | `primary` | User-facing coordinator with routing, delegation, background tasks, and specialist handoffs |
| `plan` | `primary` | Planning mode; normal edits are denied except plan files |

There is no native `chat` agent. GUI general-chat workspaces now default to `assistant`.

Hidden/system agents still exist for internal runtime jobs:

| Agent | Mode | Role |
|-------|------|------|
| `compaction` | `primary` hidden | Summarizes long tool outputs |
| `title` | `primary` hidden | Generates short conversation titles |
| `summary` | `primary` hidden | Summarizes conversation history |

## Specialist Agents

The OpenSwarm-style specialist team is registered as native subagents:

| Agent | Owns |
|-------|------|
| `virtual-assistant` | everyday assistant workflows, external systems, messaging, scheduling, Composio integrations |
| `deep-research` | web research, citations, source-backed synthesis |
| `data-analyst` | structured data analysis, charts, statistics, isolated Python-style work |
| `slides-agent` | HTML slide decks and PPTX exports |
| `docs-agent` | Word, PDF, Markdown, TXT, and formatted deliverables |
| `image-generation-agent` | image generation, editing, and visual asset creation |
| `video-generation-agent` | video generation, editing, assembly, and clip workflows |

`general` is also a built-in subagent. It is a generic provider-prompt subagent with `todowrite` denied. It is useful as a lightweight fallback worker, but it is not one of the OpenSwarm specialists.

## Spawn Rules

When `assistant` spawns a subagent, the child is not automatically a build agent. The runtime uses the exact requested agent name:

- `subagent_type: "deep-research"` creates a Deep Research child session
- `subagent_type: "docs-agent"` creates a Docs Agent child session
- `recipient_agent: "slides-agent"` creates a Slides Agent child session

The requested agent must be registered and spawnable. The runtime rejects primary or blocked agents.

Blocked spawn names:

- `build`
- `plan`
- `assistant`
- `chat`
- `orchestrator`

This keeps user-facing primaries and removed/merged coordinator names out of child-session execution.

## Communication Tools

### `send_message`

`send_message` is the OpenSwarm-style bounded delegation surface.

Use it when `assistant` needs one or more specialists to perform independent subtasks and return results. Each recipient runs in its own child session with that agent's prompt, permissions, model override, and tools.

The child result returns to `assistant`; control does not move to the child.

### `transfer`

`transfer` is the single-specialist handoff surface.

Use it when the current conversation should move to one specialist. The recipient gets useful conversation context and continues with the user. After transfer, `assistant` should not keep answering as if it still owns the turn.

## Tool Access Rules

Delegation and meta-orchestration tools are assistant-only:

- `task`
- `background_task`
- `background_task_list`
- `background_task_get`
- `background_task_cancel`
- `background_task_graph`
- `background_task_graph_list`
- `background_task_graph_get`
- `background_task_graph_cancel`
- `send_message`
- `transfer`

These tools are denied for:

- `build`
- `plan`
- `explore`
- `general`
- all OpenSwarm specialists
- any removed or merged coordinator such as `orchestrator`

Specialist tools remain owner-gated. For example:

- `docs` tools only go to `docs-agent`
- `slides` tools only go to `slides-agent`
- `data_kernel` tools only go to `data-analyst`
- `composio` tools only go to `virtual-assistant`
- image tools only go to `image-generation-agent`
- video tools only go to `video-generation-agent`

## Per-User OAuth Foundation

External personal-account integrations use `IntegrationAuth`.

Credentials are scoped by:

```text
{ user/account, provider, connection }
```

The server exposes integration APIs for:

- listing available integrations and connected accounts
- starting OAuth
- completing OAuth callbacks
- refreshing credentials
- revoking credentials
- reporting missing scopes or setup status

Tools must not expose raw access tokens, refresh tokens, or provider secrets in logs, prompts, tool output, or artifacts.

## Specialist Tool Status

The first implementation prioritizes the native routing and production-shaped tool contracts over complete provider depth.

Current specialist tooling includes:

- Composio setup-aware Virtual Assistant contracts
- native research report generation with a source ledger shape
- local Data Analyst kernel scaffolding with artifact paths and timeout/error reporting
- native docs and slides artifact helpers
- image and video provider adapter stubs with exact missing-credential guidance

Missing credentials or unconnected accounts should produce setup guidance instead of crashing or disappearing.

## Artifacts

Generated files should use shared artifact helpers and default to:

```text
deliverables/
```

Tool results should return structured metadata and file attachments where possible. User-facing responses should summarize delivered file paths instead of dumping raw generated source.

## Key Source Files

| File | Role |
|------|------|
| `packages/opencode/src/agent/agent.ts` | Registers native primary agents, specialist subagents, prompts, permissions, and defaults |
| `packages/opencode/src/agent/communication.ts` | Defines default communication flows |
| `packages/opencode/src/agent/spawnable.ts` | Blocks non-spawnable primary/removed coordinator names |
| `packages/opencode/src/tool/registry.ts` | Gates assistant-only and specialist-owned tools |
| `packages/opencode/src/tool/task.ts` | Synchronous/background subagent entry point |
| `packages/opencode/src/session/task-execution.ts` | Shared child-session execution machinery |
| `packages/opencode/src/tool/send_message.ts` | Bounded specialist delegation |
| `packages/opencode/src/tool/transfer.ts` | Session handoff event/tool |
| `packages/opencode/src/integration/auth.ts` | Per-user integration credential service |
| `packages/opencode/src/server/routes/instance/integration.ts` | Integration OAuth/status APIs |
| `packages/opencode/src/tool/openswarm/` | Shared OpenSwarm specialist artifact/tool helpers |
| `packages/opencode/src/tool/openswarm_stub.ts` | Setup-aware specialist tool implementations |

## Test Coverage

Core tests cover:

- assistant-only registry exposure for delegation/meta tools
- build/plan/specialists not receiving delegation/meta tools
- blocked spawn names
- allowed and denied communication flows
- same pair supporting multiple communication modes
- `send_message` child-session execution
- `transfer` handoff event behavior
- docs/slides artifact creation
- missing-credential guidance
- per-user OAuth service behavior

Useful focused command:

```bash
bun test --cwd packages/opencode test/agent/agent.test.ts test/tool/task.test.ts test/tool/openswarm-routing.test.ts test/tool/registry.test.ts
```

Pair it with:

```bash
bun run --cwd packages/opencode typecheck
```
