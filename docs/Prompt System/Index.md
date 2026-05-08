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
- [[Prompt System/Provider Prompts]] — provider prompt selection and file catalog (GPT, Claude, Gemini, Kimi, etc.)
- [[Prompt System/Agent Prompts]] — built-in agents, custom agents, config-driven agents
- [[Prompt System/Instructions]] — AGENTS.md, remote instructions, dynamic file-walk rules
- [[Prompt System/Skills]] — skill discovery, loading, and the `skill` tool
- [[Prompt System/Prompt Assembly Flow]] — the exact order things are joined in `llm.ts` and `prompt.ts`

For agent definitions and tool access rules, see [[Agents/Index]].

## Key Source Files

| File | Role |
|------|------|
| `packages/opencode/src/session/llm.ts` | Prompt assembly and streaming |
| `packages/opencode/src/session/prompt.ts` | Session loop, tool resolution, shell prompting |
| `packages/opencode/src/session/system.ts` | Provider prompt selection + environment + skills |
| `packages/opencode/src/session/instruction.ts` | AGENTS.md discovery, loading, dynamic rules |
| `packages/opencode/src/agent/agent.ts` | Agent registry: built-in + config + markdown agents |
| `packages/opencode/src/skill/index.ts` | Skill discovery, loading, and formatting |

## Related

- [[Agents/Index]] — agent capability matrix and tool access rules
- [[Agents/Permission System]] — hard permission enforcement for tool access
- [[Architecture/OpenSwarm Integration]] — assistant-only swarm tools, specialist routing, per-user OAuth
