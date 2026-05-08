# Prompt System

How OpenAgent assembles the system context that every LLM call receives.

The final system prompt is not a single file. It is built from multiple layers at runtime.

## Top-Level Layers

```
final system text =
  1. Base prompt (agent prompt OR provider prompt)
  2. AGENTS.md / instruction files / remote URLs
  3. Environment info
  4. Available skills summary
  5. Optional per-message system text
```

## Contents

- [[Prompt System/Overview]] — the mental model and why the stack matters
- [[Prompt System/Base Prompt]] — provider prompts (GPT, Claude, Gemini, Kimi, etc.)
- [[Prompt System/Agent Prompts]] — built-in agents, custom agents, config-driven agents
- [[Prompt System/Primary Agents]] — the main user-facing agents and how `build`, `assistant`, and `plan` differ
- [[Prompt System/Instructions]] — AGENTS.md, remote instructions, dynamic file-walk rules
- [[Prompt System/Skills]] — skill discovery, loading, and the `skill` tool
- [[Prompt System/Permission System]] — how permissions constrain behaviour outside prompts
- [[Prompt System/Prompt Assembly Flow]] — the exact order things are joined in `llm.ts` and `prompt.ts`
- [[Prompt System/Provider Prompt Catalog]] — what each provider-specific prompt targets

## Key Source Files

| File | Role |
|------|------|
| `packages/opencode/src/session/llm.ts` | Prompt assembly and streaming |
| `packages/opencode/src/session/prompt.ts` | Session loop, tool resolution, shell prompting |
| `packages/opencode/src/session/system.ts` | Provider prompt selection + environment + skills |
| `packages/opencode/src/session/instruction.ts` | AGENTS.md discovery, loading, dynamic rules |
| `packages/opencode/src/agent/agent.ts` | Agent registry: built-in + config + markdown agents |
| `packages/opencode/src/skill/index.ts` | Skill discovery, loading, and formatting |
| `packages/opencode/src/permission/index.ts` | Permission evaluation (`allow`/`deny`/`ask`) |

## Related Architecture

- [[Architecture/Native OpenSwarm Integration]] — assistant-only delegation, specialist agents, `send_message`, `transfer`, and per-user OAuth
