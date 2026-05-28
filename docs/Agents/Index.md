# Agents

OpenAgent ships 14 native agents across 4 categories.

## Primary Agents (User-Facing)

| Agent | Mode | Role | `task` | Background/Graph | `send_message` |
|-------|------|------|--------|-----------------|----------------|
| `build` | `primary` | Coding agent — code generation, editing, refactoring, debugging | allow | deny | deny |
| `assistant` | `primary` | General-purpose non-coding agent — research, delegation, specialist routing, all new capabilities | allow | allow | allow |
| `plan` | `primary` | Planning mode; edits denied except `.openagent/plans/*.md` | deny | deny | deny |

## System Agents (Hidden)

| Agent | Mode | Role |
|-------|------|------|
| `compaction` | `primary` (hidden) | Summarizes long tool outputs |
| `title` | `primary` (hidden) | Generates short conversation titles |
| `summary` | `primary` (hidden) | Summarizes conversation history |

## Generic Subagents

| Agent | Mode | Role | Specialist Tool | Communication |
|-------|------|------|----------------|---------------|
| `general` | `subagent` | General-purpose worker; `todowrite` denied | none | `send_message` only |
| `explore` | `subagent` | Fast codebase exploration; restricted to `grep`, `glob`, `list`, `bash`, `webfetch`, `websearch`, `read` | none | not a default recipient |

## OpenSwarm Specialist Subagents

| Agent | Mode | Specialist Tool(s) | Communication |
|-------|------|--------------------|---------------|
| `deep-research` | `subagent` | `deep_research` | `send_message` |
| `data-analyst` | `subagent` | `data_kernel` | `send_message` |
| `slides-agent` | `subagent` | `slides_plan`, `slides_modify`, `slides`, `slides_theme`, `slide_screenshot`, `slide_overflow_check` | `send_message` |
| `docs-agent` | `subagent` | `docs` | `send_message` |
| `image-generation-agent` | `subagent` | `image_generation` | `send_message` |
| `video-generation-agent` | `subagent` | `video_generation` | `send_message` |

## Tool Access Rules

Three registry gating layers control who gets which tool:

1. **Blocking `task`** — only `build` and `assistant`. Denied for all others.
2. **Assistant-only orchestration** — `background_task`, `background_task_graph`, all their management tools, `send_message`, and `composio`. Only `assistant`.
3. **Specialist owner-gated** — each specialist tool goes exclusively to its owner agent.

## Blocked Spawn Names

Cannot be spawned as subagents: `build`, `plan`, `assistant`, `chat`, `orchestrator`.

## Related Docs

- [[Agents/Primary Agents]] — detailed breakdown of build, assistant, and plan
- [[Agents/OpenSwarm Specialists]] — specialist prompts, own tools, role descriptions
- [[Agents/Permission System]] — hard enforcement layer, permission evaluation, ask/deny/allow
- [[Architecture/OpenSwarm Integration]] — native routing, communication flows, per-user OAuth
