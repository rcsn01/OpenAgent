# Provider Prompts

## Selection Logic

The base prompt is selected at runtime in `packages/opencode/src/session/system.ts` based on the active model's ID string:

```ts
export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) return [PROMPT_CODEX]
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}
```

Priority order:
1. GPT-4 / o1 / o3 → `beast.txt`
2. "gpt" → `codex.txt` (if codex) else `gpt.txt`
3. "gemini-" → `gemini.txt`
4. "claude" → `anthropic.txt`
5. "trinity" → `trinity.txt`
6. "kimi" → `kimi.txt`
7. Fallback → `default.txt`

## When It Is Used

The provider prompt is used when the active agent does **not** define its own `prompt` field. The deciding line is in `packages/opencode/src/session/llm.ts`:

```ts
const basePrompt = input.agent.prompt
  ? [...(extendProviderPrompt ? SystemPrompt.provider(input.model) : []), input.agent.prompt]
  : SystemPrompt.provider(input.model)
```

Agents like `build`, `plan`, and `general` use provider prompts. `assistant` sets `options.extend_provider_prompt: true` to keep the provider prompt and append its own on top.

## Prompt File Catalog

### beast.txt
**Target:** GPT-4 / o1 / o3 | **Size:** 147 lines

Autonomous problem-solving agents:
- Thorough thinking, avoid repetition
- Iterate until completely solved
- Use `webfetch` to verify understanding
- Sequential thinking for complex problems
- Extensive testing and verification
- Todo tracking with checklists

### gpt.txt
**Target:** OpenAI GPT (non-reasoning) | **Size:** 107 lines

Senior-engineer persona:
- Pragmatic, direct software engineer
- Autonomy and persistence
- Parallelize tool calls extensively
- Editing minimalism — smallest correct changes
- Formatting rules (nested bullets forbidden)

### codex.txt
**Target:** OpenAI Codex | **Size:** 79 lines

- ASCII-only editing, minimal comments
- `apply_patch` preferred for single-file edits
- Parallel tool calls strongly encouraged
- Git hygiene — never revert others' changes
- Frontend design — avoid bland layouts

### anthropic.txt
**Target:** Anthropic Claude | **Size:** 105 lines

- Professional objectivity over validation
- TodoWrite tool mandatory, frequent use
- Proactive Task tool usage for exploration
- One specialized tool per step
- Code references with `file_path:line_number`

### gemini.txt
**Target:** Google Gemini | **Size:** 155 lines

Structured guidance:
- Core mandates (conventions, library verification, style)
- Primary workflows (software engineering + new applications)
- Operational guidelines (tone, security, tool usage)

### copilot-gpt-5.txt
**Target:** Copilot GPT-5 | **Size:** 143 lines

Copilot-specific conventions and behaviors.

### trinity.txt
**Target:** Trinity | **Size:** 97 lines

Similar to default.txt but with one-tool-per-message restriction and strict conciseness.

### kimi.txt
**Target:** Moonshot Kimi | **Size:** 95 lines

- AGENTS.md awareness
- Understand before changing, minimal changes
- KISS principle emphasis
- No git commits unless asked

### default.txt
**Target:** Catch-all (Cursor, etc.) | **Size:** 105 lines

Balanced general-purpose prompt: conciseness, proactiveness, code conventions, no comments unless asked, parallel tool optimization, git safety.

### plan.txt
**Target:** General plan mode | **Size:** 26 lines

Core distinction: planning phase vs task execution phase.

### plan-reminder-anthropic.txt
**Target:** Claude in plan mode | **Size:** 67 lines

Plan mode reminders specific to Claude models.

### max-steps.txt
**Target:** Injected when step limit exists | **Size:** 15 lines

Reminder about maximum step limit before forcing text-only response.

## Key Takeaway

Provider prompts encode provider-specific nuances. They are the foundation that everything else stacks on top of. The selection happens at runtime based on the active model string, not the active agent.
