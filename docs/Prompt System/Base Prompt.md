# Provider Prompts (Base Prompt)

## Selection Logic

The base prompt is selected in `packages/opencode/src/session/system.ts`.

```ts
export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}
```

The selection is a chain of substring checks in this exact priority order:

1. GPT-4 / o1 / o3 family → `beast.txt`
2. "gpt" substring (not matching above) → check for "codex" → `codex.txt` else `gpt.txt`
3. "gemini-" → `gemini.txt`
4. "claude" → `anthropic.txt`
5. "trinity" (case-insensitive) → `trinity.txt`
6. "kimi" (case-insensitive) → `kimi.txt`
7. Fallback → `default.txt`

## When It Is Used

The provider prompt is used when the active agent does **not** define its own `prompt` field. The deciding line is in `packages/opencode/src/session/llm.ts`:

```ts
const basePrompt = input.agent.prompt
  ? [...(extendProviderPrompt ? SystemPrompt.provider(input.model) : []), input.agent.prompt]
  : SystemPrompt.provider(input.model)
```

So the provider prompt is used by default for agents like `build`, `plan`, and `general`.

An agent can set `options.extend_provider_prompt: true` (only the `assistant` agent does this today) to keep the provider prompt and append its own on top.

## Prompt File Catalog

| File | Target Provider | Size | What It Enforces |
|------|----------------|------|------------------|
| `anthropic.txt` | Anthropic Claude | 105 lines | Professional objectivity, todo tracking, task-tool usage, tool usage rules, code references |
| `beast.txt` | GPT-4 / o1 / o3 | 147 lines | Autonomous problem-solving, thorough iteration, extensive internet research, sequential thinking, todo tracking, memory |
| `codex.txt` | OpenAI Codex | 79 lines | Editing constraints (ASCII, apply_patch), tool usage (read/edit/write/bash), git hygiene, frontend design, final answer structure |
| `copilot-gpt-5.txt` | Copilot GPT-5 | 143 lines | *(See source file — covers Copilot-specific conventions)* |
| `default.txt` | Catch-all (Cursor, etc.) | 105 lines | Conciseness, proactiveness, code conventions, no comments, task management, tool usage, examples |
| `gemini.txt` | Google Gemini | 155 lines | Core mandates, primary workflows (SE + new apps), operational guidelines, tone & style, interaction details |
| `gpt.txt` | OpenAI GPT (non-o) | 107 lines | Pragmatic software engineer, autonomy, persistence, editing approach, formatting rules, response channels |
| `kimi.txt` | Moonshot Kimi | 95 lines | AGENTS.md awareness, coding guidelines, project info, KISS principle |
| `max-steps.txt` | *(Injected when needed)* | 15 lines | Reminder that the agent has a max steps limit |
| `plan-reminder-anthropic.txt` | Anthropic plan mode | 67 lines | Plan mode reminders for Claude-specific models |
| `plan.txt` | General plan mode | 26 lines | High-level plan vs task distinction |
| `trinity.txt` | Trinity | 97 lines | Conciseness, proactiveness, conventions, one-tool-per-message |

## Key Takeaway

Provider prompts encode provider-specific nuances. They are the foundation that everything else stacks on top of. The selection happens at runtime based on the active model string, not the active agent.
