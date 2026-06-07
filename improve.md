# Improvement Plan: Making `build` Update Its Plan Reliably

## The Problem

When OpenAgent `build` works on a multi-step task, it often creates a todo list (`todowrite`) at the beginning, then never updates it again. The user is left with a stale checklist that says items are "pending" even though the agent completed them several turns ago. The model forgets to update its own plan because the reminder only exists in the tool description — not in the system prompt.

**Codex CLI does not have this problem.** Its model updates the plan reliably because the instruction is **baked into the system prompt** and **reinforced on every auto-continuation**.

---

## How Codex CLI Solves This

Codex CLI uses **two layers** of prompt reinforcement:

### Layer 1: Standing instruction in the base system prompt

In the core model instructions (`gpt-5.2-codex_instructions_template.md`):

```markdown
## Plan tool

When using the planning tool:
- Skip using the planning tool for straightforward tasks (roughly the easiest 25%).
- Do not make single-step plans.
- When you made a plan, update it after having performed one of the sub-tasks that you shared on the plan.
```

This is **not** the tool description. This is a **system-level behavioral rule** that the model sees on every single turn, regardless of whether it uses the tool.

### Layer 2: Reinforcement during auto-continuations

In the goal continuation prompt template (`templates/goals/continuation.md`):

```markdown
If update_plan is available and the next work is meaningfully multi-step, use it to show a concise plan tied to the real objective. Keep the plan current as steps complete or the next best action changes.
```

When Codex auto-continues a turn because the goal is still active, it injects this reminder. The model sees the plan-update instruction **again** right before it resumes work.

**Result**: The model is reminded so frequently that updating the plan becomes habitual. It doesn't need to "remember" — it's told explicitly.

---

## How OpenAgent Works Today

OpenAgent's `todowrite` has a **rich tool description** (`external opencode runtime/src/tool/todowrite.txt`):

```markdown
## When to use
Use proactively when:
- The task requires 3+ distinct steps or actions
- You start a task - mark it `in_progress` (only one at a time) before working
- You finish a task - mark it `completed` and add any follow-ups discovered during the work

## Rules
- Update status in real time; don't batch completions
- Mark `completed` only after the required work is actually done
- Keep exactly one `in_progress` while work remains
```

**But** this description is **only visible when the model considers calling the tool**. It is not a standing system-level instruction. There is **no** equivalent to Codex CLI's `## Plan tool` section in the base prompt, and there is **no** continuation prompt that reinforces it.

**Result**: The model often creates the todo list once, then treats it as "done" and never updates it again. The user sees stale status.

---

## The Fix

### Option A: Add a standing system prompt instruction (recommended)

In `external opencode runtime/src/session/prompt.ts` or `external opencode runtime/src/session/system.ts`, append a concise reminder to the system prompt stack:

```markdown
## Task tracking

When you create a todo list for multi-step work, update it in real time as steps are completed or blocked. Keep exactly one item `in_progress`. Do not leave the list stale across turns.
```

This should be injected **for every turn**, not just when the model happens to look at the `todowrite` tool definition.

### Option B: Reinforce on session resumption / continuation

If OpenAgent ever adds auto-continuation (when a turn ends and the model should keep working), include the plan-update reminder in the continuation prompt:

```markdown
Continue working on the current task. If there is an active todo list, update it to reflect completed and current work before proceeding.
```

### Option C: Make `todowrite` behave like Codex CLI's `update_plan`

Codex CLI's `update_plan` is explicitly labeled a **"TODO/checklist tool"** (`plan.rs:81`). Its handler is a no-op that just fires a UI event. OpenAgent's `todowrite` already does more (it persists to DB), but the principle is the same: both are cosmetic.

The improvement isn't in the tool mechanics — it's in **how frequently the model is told to use it**.

---

## Side Effects to Watch Out For

- **Token cost**: Adding system prompt text increases context window usage. Keep the reminder short.
- **Over-update**: The model might call `todowrite` on trivial single-step tasks if the instruction is too broad. Match Codex CLI's phrasing: *"When you made a plan, update it after having performed one of the sub-tasks that you shared on the plan."*
- **Tool hallucination**: If the model hasn't created a todo list yet, telling it to "update it" could cause confusion. Codex CLI's phrasing avoids this by referencing the plan "that you shared on the plan" — implying the plan already exists.

---

## Why This Matters More Than the Goal System

The goal runtime (`create_goal` / `update_goal`) is a **separate architectural feature** that adds runtime enforcement. But the plan-update behavior is a **prompt-level fix** that requires no new tools, no DB migrations, and no state tracking. It just makes the existing `todowrite` tool actually useful by reminding the model to use it.

Codex CLI gets reliable plan updates **without** needing a goal runtime. The goal runtime is for auto-continuation and budget enforcement — nice to have, but orthogonal to the UX problem of stale todo lists.

---

## Recommended Next Steps

1. **Add a standing instruction** to the system prompt stack for `build` (and possibly `assistant`) that tells the model to keep its todo list current.
2. **Keep `todowrite` unchanged** — it's already equivalent to Codex CLI's `update_plan`.
3. **Consider Option B** later if/when auto-continuation is implemented.

## References

### Codex CLI
- `codex-rs/core/gpt-5.2-codex_instructions_template.md:57-62` — Standing `## Plan tool` instruction in base prompt.
- `codex-rs/core/templates/goals/continuation.md:23` — Reinforcement in continuation prompt template.
- `codex-rs/core/src/tools/handlers/plan.rs:79-82` — `update_plan` handler explicitly labeled "TODO/checklist tool".

### OpenAgent
- `external opencode runtime/src/tool/todowrite.txt` — Current tool description.
- `external opencode runtime/src/session/prompt.ts` — Session loop where system prompt reminders are injected.
- `external opencode runtime/src/session/system.ts` — System prompt assembly.
