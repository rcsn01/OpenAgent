# Feasibility Analysis: Incorporating Codex CLI's Instruction System into OpenAgent `build`

*Technical assessment comparing the instruction resolution, delivery, and update mechanisms of the Codex CLI (Rust) with OpenAgent's `build` agent.*

---

## Executive Summary

**Yes, it is possible** — and in many ways, OpenAgent already implements a superset of Codex CLI's behavior. However, there are **three specific Codex CLI patterns** that could be adopted to strengthen `build`:

1. **Formal base instruction priority chain** (config → history → model default)
2. **Hierarchical project instruction discovery** (all `AGENTS.md` from root to CWD, not just the nearest)
3. **Per-message on-demand instruction resolution** (attaching nearby `AGENTS.md` when a file is read, exactly once per message)

These are **incremental improvements**, not fundamental rearchitectures. OpenAgent's instruction system (`src/session/instruction.ts`) is already more advanced in several areas (remote URL loading, per-message tracking, dynamic agent prompting).

---

## Part 1: What Codex CLI Does

### 1.1 Base Instruction Resolution

Codex CLI resolves the `instructions` field (the system prompt) in a strict priority order:

```text
# Priority (highest to lowest)
1. User config override     (config.base_instructions)
2. Persisted instructions     (resumed conversation history)
3. Model default            (model_info.get_model_instructions(config.personality))
```

This is hardcoded in `codex-rs/core/src/session/mod.rs:544-555`:

```rust
let base_instructions = config
    .base_instructions
    .clone()
    .or_else(|| conversation_history.get_base_instructions().map(|s| s.text))
    .unwrap_or_else(|| model_info.get_model_instructions(config.personality));
```

### 1.2 User Instructions (Project Documentation)

Codex CLI discovers `AGENTS.md` files via a **hierarchical walk** from CWD to project root, determined by markers like `.git`.

- It collects **all** `AGENTS.md` and `AGENTS.override.md` files along the path.
- It concatenates them with the separator `\n\n--- project-doc ---\n\n`.
- This content becomes `session_configuration.user_instructions`.

This is defined in `codex-rs/core/src/agents_md.rs`.

### 1.3 Session Startup Prewarm

When the session initializes, Codex CLI uses the resolved `base_instructions` to "prewarm" the model connection — essentially establishing the WebSocket with the system prompt so the first real turn is faster.

### 1.4 Tool Output Re-serialization

Codex CLI post-processes shell and patch tool outputs into a structured format before injecting them back into the conversation history (`client_common.rs:reserialize_shell_outputs`):

```text
Exit code: 0
Wall time: 1.23 seconds
Total output lines: 42
Output:
...
```

### 1.5 Real-Time Backend Prompts

Codex CLI supports a separate real-time mode with its own backend prompt template that includes identity lines and user personalization.

---

## Part 2: What OpenAgent `build` Currently Does

### 2.1 Base Prompt Assembly

OpenAgent's prompt assembly is in `src/session/llm.ts` and `src/session/prompt.ts`.

The system prompt stack is (`Prompt Assembly Flow.md`):

```text
1. Base prompt (provider prompt or agent prompt)
2. Custom system text
3. AGENTS.md / instruction files
4. Environment info (directory, git, platform, date, model)
5. Available skills summary
6. Per-message system text (user.system)
```

For `build`, since it has no custom agent prompt, the base is the **provider prompt** selected via `SystemPrompt.provider(model)`.

### 2.2 Instruction Discovery

OpenAgent's instruction discovery is in `src/session/instruction.ts`.

**Current behavior (system-wide):**

- Discover `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`.
- **Global files**: `~/.openagent/AGENTS.md` and `~/.claude/CLAUDE.md`.
- **Project-level**: `findUp` from CWD to worktree — but the **first match wins**. It does **not** gather all matches along the path.
- Also supports remote URLs in `config.instructions`.

**Current behavior (per-message, dynamic):**

The `resolve` method walks upward from a `read` tool's target file and attaches nearby `AGENTS.md` files, tracking them exactly once per message via a `claims` map. This prevents duplicate injection.

### 2.3 Agent-Specific Prompts

Unlike Codex CLI, OpenAgent supports **agent-specific prompts**:

- `build` uses the provider prompt directly.
- `assistant` appends `assistant.txt` + OpenSwarm routing guidance.
- Specialists get their own `role`, `owns`, and `tools` prompts.
- Plan mode gets injected reminders.

### 2.4 Tool Output Handling

OpenAgent passes tool outputs back into the history as-is. There is no normalization/re-serialization layer.

---

## Part 3: Side-by-Side Comparison

| Feature | Codex CLI | OpenAgent `build` | Notes |
|---------|-----------|-------------------|-------|
| **Base instruction source** | Config → History → Model default | Provider prompt per model | OpenAgent has no model-specific default prompt chain |
| **Project instruction discovery** | Walk all ancestors from CWD to root, concatenate all `AGENTS.md` | Walk up CWD to worktree, first match wins | OpenAgent misses nested project docs. Could adopt Codex's all-matches behavior |
| **Instruction concatenation** | `\n\n--- project-doc ---\n\n` | Appended directly to system | Codex separator is clearer; could be adopted |
| **Global instructions** | Global `AGENTS.md` discovery | `~/.openagent/AGENTS.md`, `~/.claude/CLAUDE.md` | Equivalent |
| **Per-message resolution** | N/A (system-level only) | `resolve()` attaches nearby docs per read tool call | OpenAgent is more sophisticated here |
| **Remote instructions** | Unknown | Supports HTTP(S) URLs in config | OpenAgent is more flexible |
| **History persistence** | Base instructions stored in thread metadata | N/A for base instruction chain | OpenAgent could persist instructions per-history |
| **Tool output normalization** | Re-serializes shell/tool outputs | As-is | Opportunity for OpenAgent |
| **Real-time mode** | Dedicated backend prompt | Not supported | Gap in OpenAgent |
| **Agent-specific prompts** | Unified codex identity | Provider prompt + per-agent custom prompts | OpenAgent's approach is more flexible for multi-agent |

---

## Part 4: What Can Be Adopted (Prioritized)

### P1: Hierarchical Project Instruction Discovery

**What**: Instead of "first match wins," collect **all** `AGENTS.md`/`CLAUDE.md` from CWD up to the project root, concatenate them, and append to the system prompt.

**Where to change**: `src/session/instruction.ts:systemPaths()`

**Current behavior** (simplified):

```typescript
for (const file of FILES) {
  const matches = yield* fs.findUp(file, ctx.directory, ctx.worktree)
  if (matches.length > 0) {
    matches.forEach((item) => paths.add(path.resolve(item)))
    break // <-- STOPS AT FIRST MATCH
  }
}
```

**Adopted behavior (Codex-style)**:

```typescript
const allPaths: string[] = []
for (const file of FILES) {
  const matches = yield* fs.findUpAll(file, ctx.directory, ctx.worktree) // hypothetical: find ALL, not just nearest
  if (matches.length > 0) {
    allPaths.push(...matches.reverse()) // root-first order
  }
}
// Concatenate with separator
return allPaths
```

This is the **highest-impact, lowest-risk** change. It makes nested monorepo instructions work correctly.

### P2: Model-Specific Default Prompt Chain

**What**: If no `AGENTS.md` or config instructions exist, fall back to model-specific default instructions.

**Where to add**: `src/session/system.ts` or config layer.

Currently, OpenAgent uses static `.txt` provider prompts (`gpt.txt`, `anthropic.txt`, etc.) selected by model ID. Codex CLI has a dynamic `model_info.get_model_instructions(config.personality)`.

This would require:
- Adding a `base_instructions` field to provider/model config.
- Or resolving it from model metadata at runtime.

### P3: Tool Output Re-serialization

**What**: Normalize shell and patch tool outputs before re-injecting them into the conversation.

**Where to add**: `src/session/prompt.ts` or a new normalization module.

Codex CLI transforms:

```json
{"output": "...", "metadata": {"exit_code": 0, "duration_seconds": 1.2}}
```

Into:

```text
Exit code: 0
Wall time: 1.2 seconds
Output:
...
```

This saves tokens and improves model comprehension.

### P4: Base Instruction Persistence in History

**What**: Persist the resolved base instructions into conversation history so that on resume, the session can restore its original instruction set.

**Where to add**: Thread/session metadata persistence.

Codex CLI does this via `get_base_instructions_from_history()`. OpenAgent doesn't currently track instruction provenance across sessions.

### P5: Real-Time Backend Prompt Template

**What**: A dedicated prompt template and personalization for real-time/streaming mode.

**Where to add**: New module for real-time sessions.

This is only relevant if OpenAgent adds voice/real-time coding features.

---

## Part 5: Implementation Recommendations

### Recommended: Adopt P1 (Hierarchical Discovery)

Modify `src/session/instruction.ts` to collect all instruction files along the path, matching Codex CLI's approach.

**Pros:**
- Monorepos with root-level conventions + package-level overrides now work.
- Zero user-facing changes; just better behavior.

**Cons:**
- Slightly more file system access on startup.
- Need to deduplicate paths and order them correctly (root-to-CWD).

### Optional: Adopt P2 (Model Default Chain)

Add `base_instructions` to the provider/model configuration so that `build` can fall back to a model-specific default when no project docs exist.

**Pros:**
- Matches Codex CLI's behavior for model-aware system prompts.

**Cons:**
- Requires config schema changes.
- Value is low if provider prompts (`gpt.txt`) are already tuned.

### Recommended: Pilot P3 (Tool Output Normalization)

Add a normalization step for shell/exec tool outputs before they are appended to the conversation history.

**Pros:**
- Token savings on long shell outputs.
- Better model comprehension.

**Cons:**
- Could lose structured metadata if not careful.
- Needs to be opt-in per tool type.

---

## Part 6: What OpenAgent Does Better

Not everything should move toward Codex CLI. OpenAgent already has advantages:

| Feature | Why OpenAgent is Better |
|---------|-------------------------|
| **Per-message resolution** | Codex CLI only does system-level instruction discovery. OpenAgent's `resolve()` method dynamically attaches nearby docs when `read` is called, preventing stale context. |
| **Remote instructions** | Codex CLI doesn't seem to support remote URLs. OpenAgent fetches HTTP(S) config instructions. |
| **Agent-specific prompting** | Codex CLI has a unified identity. OpenAgent's per-agent prompts (`assistant.txt`, specialist prompts, plan reminders) allow finer-grained behavior control. |
| **Plugin hook integration** | OpenAgent plugins can transform system text via `experimental.chat.system.transform`. Codex CLI is monolithic. |
| **Skill discovery** | OpenAgent dynamically injects available skill descriptions. Codex CLI doesn't appear to have a skill layer. |

---

## Conclusion

OpenAgent `build` can **selectively adopt** Codex CLI's instruction patterns to improve robustness, especially around **hierarchical AGENTS.md discovery** and **tool output normalization**. However, OpenAgent's existing architecture is already more flexible and feature-rich in areas like per-message resolution, remote instructions, and multi-agent prompt customization.

The adoption should be **incremental and backward-compatible** — Codex CLI's patterns should fill gaps, not replace OpenAgent's superior mechanisms.

## References

### Codex CLI
- `codex-rs/core/src/session/mod.rs:544-555` — Base instruction resolution chain.
- `codex-rs/core/src/agents_md.rs` — Hierarchical AGENTS.md discovery.
- `codex-rs/core/src/client_common.rs` — Tool output re-serialization.
- `codex-rs/core/src/realtime_prompt.rs` — Real-time backend prompt.
- `codex-rs/core/src/client.rs:746-765` — API request payload construction.

### OpenAgent
- `packages/openagent/src/session/instruction.ts` — Instruction discovery, loading, per-message resolution.
- `packages/openagent/src/session/system.ts` — Provider prompt selection, environment info, skills.
- `packages/openagent/src/session/prompt.ts` — Session loop, tool orchestration, plan/build mode switching.
- `packages/openagent/src/session/llm.ts` — Prompt assembly, streaming.
- `docs/Prompt System/Prompt Assembly Flow.md` — Full system prompt stack.
- `docs/Agents/Primary Agents.md` — Build agent definition and role.
- `docs/Prompt System/Codex CLI Prompt Architecture.md` — Prior Codex CLI analysis.
- `docs/Prompt System/Codex CLI vs Build Agent Comparison.md` — Side-by-side comparison.
