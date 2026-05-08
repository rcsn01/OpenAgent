# Agent Prompts

## Core Rule

An agent's `prompt` field overrides the provider prompt. The decision is made in `packages/opencode/src/session/llm.ts`:

```ts
const basePrompt = input.agent.prompt
  ? [...(extendProviderPrompt ? SystemPrompt.provider(input.model) : []), input.agent.prompt]
  : SystemPrompt.provider(input.model)
```

So the rule is:

- **If the resolved agent defines `prompt`** → use that agent prompt (optionally prepending the provider prompt)
- **Otherwise** → use the provider prompt

## Built-in Agents with Custom Prompts

| Agent | Mode | Prompt File | What It Does |
|-------|------|-------------|--------------|
| `assistant` | `primary` | `packages/opencode/src/agent/prompt/assistant.txt` plus native OpenSwarm routing guidance in `agent.ts` | Extends the provider prompt with delegation, background-task, specialist routing, existing-session `send_message`, and `transfer` guidance |
| `explore` | `subagent` | `packages/opencode/src/agent/prompt/explore.txt` | Fast codebase exploration: grep, glob, list, bash, web — quick/medium/very-thorough modes |
| `compaction` | `primary` (hidden) | `packages/opencode/src/agent/prompt/compaction.txt` | Summarizes long tool outputs into compact form |
| `title` | `primary` (hidden) | `packages/opencode/src/agent/prompt/title.txt` | Generates short conversation titles |
| `summary` | `primary` (hidden) | `packages/opencode/src/agent/prompt/summary.txt` | Summarizes full conversation history |

## Built-in Agents Without Custom Prompts

| Agent | Mode | Notable Options |
|-------|------|-----------------|
| `build` | `primary` | Most tools allowed, plan/question/enter allowed |
| `plan` | `primary` | All edits denied, plan_exit allowed |
| `general` | `subagent` | `todowrite: deny` |

These agents rely on provider prompts + permissions to define behavior.

The native `chat` agent was removed. The shared GUI chat profile still exists, but hidden general-chat workspaces now default to `assistant`.

## OpenSwarm Specialist Prompts

OpenSwarm-style specialist prompts are built in `packages/opencode/src/agent/agent.ts` rather than separate prompt files.

| Agent | Mode | What It Does |
|-------|------|--------------|
| `virtual-assistant` | `subagent` | Everyday assistant workflows, external systems, messaging, scheduling, Composio integrations |
| `deep-research` | `subagent` | Evidence-based web research, citations, source-backed synthesis |
| `data-analyst` | `subagent` | Structured data analysis, charts, KPIs, statistical summaries |
| `slides-agent` | `subagent` | HTML slide decks and PPTX exports |
| `docs-agent` | `subagent` | Word/PDF/Markdown/TXT documents and formatted deliverables |
| `image-generation-agent` | `subagent` | Image generation, editing, and visual assets |
| `video-generation-agent` | `subagent` | Video generation, editing, assembly, and clip workflows |

For a runtime-focused comparison of the main primary agents, see [[Prompt System/Primary Agents]].

## Agent Definition Schema

Agents are defined in `packages/opencode/src/agent/agent.ts` with this schema:

```ts
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(Schema.Struct({ modelID: ModelID, providerID: ProviderID })),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
})
```

## Custom Agent Sources

You can add custom agents from three sources:

### 1. `opencode.json`

```json
{
  "agent": {
    "my-agent": {
      "prompt": "You are a specialized reviewer...",
      "mode": "subagent",
      "permission": {
        "edit": "deny",
        "read": "allow"
      }
    }
  }
}
```

### 2. Markdown files in `.opencode/agents/` or `~/.config/opencode/agents/`

A markdown file with frontmatter:

```markdown
---
name: my-agent
mode: subagent
---
# Custom prompt text here
```

Loading logic is in `packages/opencode/src/config/agent.ts`.

### 3. Runtime generation

The `generate` method on `Agent.Service` can generate an agent from a natural language description:

```ts
readonly generate: (input: {
  description: string
  model?: { providerID: ProviderID; modelID: ModelID }
}) => Effect.Effect<{
  identifier: string
  whenToUse: string
  systemPrompt: string
}>
```

## Practical Implications

### If you want global behavior for a repo

Use `AGENTS.md` or `opencode.json` instruction files. These append on top of the base prompt, so they work regardless of which agent is active.

### If you want one agent to behave differently

Give that specific agent its own `prompt`. This is good for:

- Review-only agents
- Planning agents
- Research agents
- Specialized subagents

### Extend Provider Prompt

The `assistant` agent sets `options.extend_provider_prompt: true`, which means it keeps the provider prompt and appends its own. This is useful when you want provider-specific conventions (e.g., GPT's formatting rules) plus custom behavior.

For the native specialist-routing architecture, see [[Architecture/Native OpenSwarm Integration]].
