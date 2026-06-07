# external orchestration Integration

OpenAgent implements the external orchestration-style routing model natively in the TypeScript runtime. It does not vendor Agency Swarm or run external orchestration as a Python sidecar.

The current design has one coordinator: the native `assistant` agent. The separate `orchestrator` agent was removed and its routing behavior was merged into `assistant`.

## Current Shape

The system has three layers:

1. Primary user-facing agents
2. Spawnable specialist subagents
3. Blocking subagent delegation and assistant-only orchestration tools

`build` and `assistant` can use the blocking `task` tool to spawn a subagent and wait for the result. Only `assistant` can use background tasks, graph tasks, and `send_message`.

## Primary Agents

| Agent | Mode | Role |
|-------|------|------|
| `build` | `primary` | Coding agent — code generation, editing, refactoring, debugging |
| `assistant` | `primary` | General-purpose non-coding agent — research, delegation, specialist routing, background work, all new capabilities |
| `plan` | `primary` | Planning mode; normal edits are denied except plan files |

There is no native `chat` agent. GUI general-chat workspaces now default to `assistant`.

Hidden/system agents still exist for internal runtime jobs:

| Agent | Mode | Role |
|-------|------|------|
| `compaction` | `primary` hidden | Summarizes long tool outputs |
| `title` | `primary` hidden | Generates short conversation titles |
| `summary` | `primary` hidden | Summarizes conversation history |

## Specialist Agents

The external orchestration-style specialist team is registered as native subagents:

| Agent | Owns |
|-------|------|
| `deep-research` | web research, citations, source-backed synthesis |
| `data-analyst` | structured data analysis, charts, statistics, isolated Python-style work |
| `slides-agent` | HTML slide decks and PPTX exports |
| `docs-agent` | Word, PDF, Markdown, TXT, and formatted deliverables |
| `image-generation-agent` | image generation, editing, and visual asset creation |
| `video-generation-agent` | video generation, editing, assembly, and clip workflows |

`general` and `explore` are also built-in subagents:
- `general` is a generic provider-prompt subagent with `todowrite` denied. It is useful as a lightweight fallback worker and is a default `send_message` recipient, but it is not one of the external orchestration specialists.
- `explore` is a fast codebase exploration subagent restricted to `grep`, `glob`, `list`, `bash`, `webfetch`, `websearch`, and `read`. It is spawnable but is not a default communication recipient.

## Spawn Rules

When `assistant` spawns a subagent through `task`, the child is not automatically a build agent. The runtime uses the exact requested agent name:

- `subagent_type: "deep-research"` creates a Deep Research child session
- `subagent_type: "docs-agent"` creates a Docs Agent child session
- `subagent_type: "slides-agent"` creates a Slides Agent child session

The requested agent must be registered and spawnable. The runtime rejects primary or blocked agents.

`build` also has opencode-style blocking `task`, but it cannot see or spawn OpenAgent feature specialists. For `build`, `task` is limited to default/custom non-OpenAgent subagents such as `general`, `explore`, or project-defined coding/review agents.

Blocked spawn names:

- `build`
- `plan`
- `assistant`
- `chat`
- `orchestrator`

This keeps user-facing primaries and removed/merged coordinator names out of child-session execution.

## Communication Tools

### `send_message`

`send_message` is the external orchestration-style bounded delegation surface.

Use it when `assistant` needs one or more subagents or specialists to continue independent work and return results. The recipient must already have an existing child session.

Default `send_message` recipients include `general` plus the external orchestration specialist team.

`send_message` does not create child sessions. If no matching child session exists, assistant must first decide which subagent type is needed and create that child session with `task`. After that, `send_message` can continue the existing session by `task_id` or by reusing the newest matching child session for that recipient.

The child result returns to `assistant`; control does not move to the child.

## Tool Access Rules

Blocking subagent delegation is available to:

- `task`

Only `build` and `assistant` receive `task`.

The rest of the orchestration and external orchestration communication tools are assistant-only:

- `background_task`
- `background_task_list`
- `background_task_get`
- `background_task_cancel`
- `background_task_graph`
- `background_task_graph_list`
- `background_task_graph_get`
- `background_task_graph_cancel`
- `send_message`

`send_message` can target `general` and the external orchestration specialists. Conversation handoff is not a tool surface; the primary agent keeps ownership and reports results back to the user.

Those assistant-only tools are denied for:

- `build`
- `plan`
- `explore`
- `general`
- all external orchestration specialists
- any removed or merged coordinator such as `orchestrator`

`task` is denied for `plan`, `explore`, `general`, all external orchestration specialists, and blocked/removed coordinator names.

Specialist tools remain owner-gated. For example:

- `docs` tools only go to `docs-agent`
- `slides` tools only go to `slides-agent`
- `data_kernel` tools only go to `data-analyst`
- `composio` tools only go to `assistant`
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

- Composio setup-aware assistant contracts
- native research report generation with a source ledger shape
- local Data Analyst kernel scaffolding with artifact paths and timeout/error reporting
- native docs artifact helpers
- external orchestration-style Slides Agent workflow: `slides_plan` for storyline, `slides_modify` for per-slide enrichment, then `slides` for editable HTML project, inferred/editorial theme CSS, previews, and valid image-backed PPTX output
- slide theme management through `slides_theme`
- slide screenshot previews through `slide_screenshot`
- slide density and overflow QA through `slide_overflow_check`
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
| `external opencode runtime/src/agent/agent.ts` | Registers native primary agents, specialist subagents, prompts, permissions, and defaults |
| `external opencode runtime/src/agent/communication.ts` | Defines default communication flows |
| `external opencode runtime/src/agent/spawnable.ts` | Blocks non-spawnable primary/removed coordinator names |
| `external opencode runtime/src/tool/registry.ts` | Gates build/assistant `task`, assistant-only orchestration, and specialist-owned tools |
| `external opencode runtime/src/tool/task.ts` | Synchronous/background subagent entry point |
| `external opencode runtime/src/session/task-execution.ts` | Shared child-session execution machinery |
| `external opencode runtime/src/tool/send_message.ts` | Bounded subagent/specialist delegation |
| `external opencode runtime/src/integration/auth.ts` | Per-user integration credential service |
| `external opencode runtime/src/server/routes/instance/integration.ts` | Integration OAuth/status APIs |
| `external opencode runtime/src/tool/openswarm/` | Shared external orchestration specialist artifact/tool helpers |
| `external opencode runtime/src/tool/openswarm/slides_html.ts` | HTML slide project generation and optional Playwright screenshot export |
| `external opencode runtime/src/tool/openswarm/slide_qa.ts` | Theme tokens, SVG slide previews, and overflow heuristics |
| `external opencode runtime/src/tool/openswarm_stub.ts` | Setup-aware specialist tool implementations |

## Test Coverage

Core tests cover:

- build and assistant registry exposure for blocking `task`
- assistant-only registry exposure for background/swarm orchestration tools
- plan/specialists not receiving delegation/meta tools
- blocked spawn names
- allowed and denied communication flows
- `send_message` child-session execution
- docs/slides artifact creation
- missing-credential guidance
- per-user OAuth service behavior

Useful focused command:

```bash
bun test --cwd external opencode runtime test/agent/agent.test.ts test/tool/task.test.ts test/tool/openswarm-routing.test.ts test/tool/registry.test.ts
```

Pair it with:

```bash
bun run --cwd external opencode runtime typecheck
```
