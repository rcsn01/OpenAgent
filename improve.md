# Improvement Plan: OpenAgent `build` vs Codex CLI

This document identifies proven patterns from the official Codex CLI (`openai/codex`) that can make the OpenAgent `build` agent more robust. It is not a proposal to copy Codex wholesale — OpenAgent's architecture is already more flexible in several areas. The goal is to close specific gaps while preserving what works well.

---

## Why Study Codex CLI?

Codex CLI is the reference implementation for a local coding agent backed by OpenAI. After reading its Rust source, we found three concrete mechanics that OpenAgent `build` could adopt:

1. **Hierarchical instruction discovery** — it walks the directory tree collecting *all* `AGENTS.md` files, not just the nearest.
2. **Tool-output re-serialization** — it normalizes shell/patch tool output into a compact, human-readable format before re-injecting it into the model context.
3. **Base-instruction priority chain** — it defines a strict fallback order when resolving the system prompt: config override → persisted history → model default.

---

## The Differences Today

| Feature | Codex CLI | OpenAgent `build` |
|---------|-----------|-------------------|
| **System prompt source** | Config → persisted history → model default | Provider prompt selected by model ID (`gpt.txt`, `anthropic.txt`, etc.) |
| **Project docs** | Walks CWD → root, concatenates *all* `AGENTS.md`/`AGENTS.override.md` | Walks CWD → worktree, **stops at first match** |
| **Tool output shape** | Re-serialized into structured human-readable text | Passed back into history **as-is** |
| **Per-message instruction resolution** | Not implemented | Already walks upward from `read` target and attaches nearby docs once per message |
| **Remote instructions** | Not supported | Supports HTTP(S) URLs in config |
| **Agent-specific prompts** | Single unified identity | Provider prompt + `assistant.txt` + specialist prompts + plan reminders |
| **Plugin system text hooks** | Not supported | `experimental.chat.system.transform` lets plugins rewrite the system text at runtime |
| **Skill discovery** | Not supported | Dynamically injects available skill descriptions into the system prompt |
| **Real-time / voice** | Dedicated backend prompt with personalization | Not supported |

OpenAgent already exceeds Codex in per-message resolution, remote instructions, multi-agent prompt customization, and plugin extensibility. The gaps are in **discovery depth**, **fallback chain**, and **tool normalization**.

---

## Recommended Improvements

### 1. Hierarchical `AGENTS.md` Discovery (P1 — High Impact, Low Risk)

**The problem**

Currently, OpenAgent stops after the first `AGENTS.md` found on the path from CWD to the workspace root. In a monorepo, you typically have a root `AGENTS.md` with project-wide conventions *and* package-level overrides. OpenAgent silently drops the root-level conventions.

**The Codex CLI approach**

Codex CLI walks the full path and concatenates all matches with the separator `\n\n--- project-doc ---\n\n`. Root conventions come first; nearest overrides come last.

**What to change**

Update `packages/opencode/src/session/instruction.ts:systemPaths()` to collect **all** matching instruction files, not just the first.

```typescript
// Current (simplified) — stops at first match
for (const file of FILES) {
  const matches = yield* fs.findUp(file, ctx.directory, ctx.worktree)
  if (matches.length > 0) {
    matches.forEach((item) => paths.add(path.resolve(item)))
    break // <-- ROOT OVERRIDES LOST
  }
}

// Proposed — collect all matches, root-first order
const allPaths: string[] = []
for (const file of FILES) {
  const matches = yield* fs.findUpAll(file, ctx.directory, ctx.worktree) // hypothetical
  if (matches.length > 0) {
    allPaths.push(...matches.reverse()) // root → CWD
  }
}
```

Concatenate them with a clear separator (Codex uses `\n\n--- project-doc ---\n\n`; we could use `\n\n---\n\n`) so the model understands that later sections are closer/more specific.

---

### 2. Base Instruction Priority Chain (P2 — Medium Impact, Medium Risk)

**The problem**

The `build` agent has no formal fallback for base instructions. If the user didn't write an `AGENTS.md` and didn't set `config.instructions`, the system prompt is just the static provider prompt. There is no way for a resumed session to remember its original system prompt, and there is no model-aware default.

**The Codex CLI approach**

Codex CLI defines a strict priority chain (`codex-rs/core/src/session/mod.rs:544-555`):

```text
1. config.base_instructions
2. conversation_history.get_base_instructions()  (persisted from prior session)
3. model_info.get_model_instructions(config.personality)
```

**What to add**

Introduce a `base_instructions` field to the session configuration and persist it in thread metadata so that resuming a thread restores the same system prompt.

Optionally, allow provider/model definitions to specify a `default_instructions` string so model-aware system prompts can be shipped alongside model configs.

**Caveat:** OpenAgent already has provider-specific prompt files (`gpt.txt`, `anthropic.txt`). If those are already well-tuned, a model default chain adds little value. This improvement is most useful when paired with **hierarchical discovery** (P1) so that model defaults act as a final safety net.

---

### 3. Tool Output Re-serialization (P3 — High Impact for Token Efficiency)

**The problem**

When OpenAgent runs a shell command, the raw JSON tool output is appended to the conversation history. For long outputs, this is noisy and token-heavy.

**The Codex CLI approach**

Codex CLI normalizes shell and patch tool outputs before re-injecting them. For example, a JSON output like this:

```json
{"output": "...", "metadata": {"exit_code": 0, "duration_seconds": 1.2}}
```

is transformed into:

```text
Exit code: 0
Wall time: 1.2 seconds
Total output lines: 42
Output:
...
```

**What to add**

In `src/session/prompt.ts` or a new normalization module, intercept shell/exec tool results before they are appended to the history. Parse the JSON, extract the human-readable payload, and discard redundant metadata.

This should be:
- **Opt-in per tool type** (not all tools emit JSON).
- **Non-destructive** (store raw result in message metadata so UI/debug tools can still access it).

---

### 4. Codex-Style Instruction Concatenation Separator

**The problem**

When multiple instruction sources are present (global, project, per-message, remote URLs), OpenAgent appends them without a clear boundary. The model cannot distinguish between a root-level convention and a package-level override.

**The Codex CLI approach**

Codex CLI explicitly separates project docs with `\n\n--- project-doc ---\n\n`. The model implicitly understands that later blocks are more specific.

**What to add**

Adopt a standard separator when combining multiple instruction sources:

```text
Instructions from: /Users/.../.opencode/AGENTS.md
...

---

Instructions from: /Users/.../my-project/AGENTS.md
...
```

This already exists in `instruction.ts` for file attribution, but it is not applied consistently across the entire instruction stack.

---

## What OpenAgent Should NOT Change

| Area | Why Keep the Current Approach |
|------|-------------------------------|
| **Per-message resolution** | OpenAgent's `resolve()` method is already more sophisticated than Codex CLI. It dynamically attaches nearby docs when a file is read, preventing stale context. |
| **Remote instructions** | Codex CLI doesn't support remote URLs. OpenAgent already does. |
| **Agent-specific prompts** | Codex CLI uses a single identity for everything. OpenAgent's per-agent prompts (`assistant.txt`, specialists, plan reminders) give finer-grained control. |
| **Background / swarm delegation** | Codex CLI supports subagent inheritance. OpenAgent intentionally restricts background tasks to `assistant`, keeping `build` focused on coding. |
| **Plugin hooks** | OpenAgent plugins can rewrite system text. Codex CLI is monolithic. |
| **Skill layer** | OpenAgent dynamically injects skill descriptions. Codex CLI doesn't appear to have a skill abstraction. |

---

## Implementation Priority

| Priority | Improvement | Effort | Impact |
|----------|------------|--------|--------|
| P1 | **Hierarchical AGENTS.md discovery** — collect all matches from root to CWD | Low | High — fixes monorepo instruction gaps |
| P3 | **Tool output re-serialization** | Medium | High — saves tokens, improves comprehension |
| P2 | **Base instruction priority chain** + persistence | Medium | Medium — makes resumed sessions consistent |
| P4 | **Codex-style separator** between instruction sources | Low | Low — nice to have, improves model parsing |

---

## References

### Codex CLI Source (analyzed from `openai/codex` main branch)
- `codex-rs/core/src/session/mod.rs:544-555` — Base instruction resolution chain.
- `codex-rs/core/src/agents_md.rs` — Hierarchical AGENTS.md discovery.
- `codex-rs/core/src/client_common.rs` — Tool output re-serialization.
- `codex-rs/core/src/realtime_prompt.rs` — Real-time backend prompt personalization.
- `codex-rs/core/src/client.rs:746-765` — API request payload construction.

### OpenAgent Source
- `packages/opencode/src/session/instruction.ts` — Instruction discovery, loading, and per-message resolution.
- `packages/opencode/src/session/system.ts` — Provider prompt selection, environment info, skills.
- `packages/opencode/src/session/prompt.ts` — Session loop, tool orchestration, plan/build mode switching.
- `packages/opencode/src/session/llm.ts` — Prompt assembly and streaming.

### OpenAgent Docs
- `docs/Prompt System/Prompt Assembly Flow.md` — Exact system prompt stack and join order.
- `docs/Prompt System/Codex CLI Prompt Architecture.md` — Deep dive into Codex CLI's prompt construction.
- `docs/Prompt System/Codex CLI vs Build Agent Comparison.md` — Side-by-side feature comparison.
- `docs/Prompt System/Codex CLI Instruction System Adoption for Build.md` — Feasibility analysis of adopting Codex patterns.
- `docs/Agents/Primary Agents.md` — Build agent definition, capabilities, and role boundaries.
