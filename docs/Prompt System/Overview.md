# Prompt System Overview

## The Mental Model

The runtime behavior is not defined by one prompt file.

A good mental model is:

```
final system =
  (agent prompt OR provider prompt)
  + AGENTS.md / instruction files
  + environment info
  + available skills summary
  + optional per-message system text
```

There is one important caveat:

```
runtime permissions, tool availability, and plugin hooks
can still constrain behavior even if prompt text says otherwise
```

## Why the Stack Exists

OpenAgent needs to support multiple providers (OpenAI, Anthropic, Google, Kimi, etc.), each with different prompt best practices. It also needs to let repos inject project-specific conventions via `AGENTS.md`, and let users customize agent behavior through custom prompts, all while keeping the system enforceable through permissions.

## Layers at a Glance

| Layer | Source | Can Override? |
|-------|--------|---------------|
| 1. Provider Prompt | `packages/opencode/src/session/prompt/*.txt` | No (selected by model) |
| 2. Agent Prompt | Agent definition in config or markdown | No (selected by runtime) |
| 3. Instructions | `AGENTS.md`, `CLAUDE.md`, remote URLs | Appends only |
| 4. Environment | `packages/opencode/src/session/system.ts` | Appends only |
| 5. Skills | `packages/opencode/src/skill/index.ts` | Appends only |
| 6. Per-Message | `user.system` on message | Appends only |

If neither an agent prompt nor an instruction file is sufficient, permissions provide hard guarantees at the tool-call level.

## Key Files

| File | Responsibility |
|------|--------------|
| `packages/opencode/src/session/llm.ts` | Prompt assembly, streaming |
| `packages/opencode/src/session/prompt.ts` | Session loop, compaction, shell |
| `packages/opencode/src/session/system.ts` | Provider prompt selection, environment, skills |
| `packages/opencode/src/session/instruction.ts` | Instruction discovery, loading |
| `packages/opencode/src/agent/agent.ts` | Agent registry |
| `packages/opencode/src/skill/index.ts` | Skill discovery, formatting |
| `packages/opencode/src/permission/index.ts` | Permission evaluation |

## Related Notes

- [[Prompt System/Provider Prompts]] — how provider prompts are selected and their full catalog
- [[Prompt System/Agent Prompts]] — how agent prompts replace or extend provider prompts
- [[Prompt System/Instructions]] — how AGENTS.md and other files stack
- [[Prompt System/Skills]] — how skills provide domain-specific instructions
- [[Prompt System/Prompt Assembly Flow]] — the exact code path and join order
- [[Agents/Index]] — the main user-facing agent definitions
- [[Agents/Permission System]] — hard constraints outside the prompt stack
