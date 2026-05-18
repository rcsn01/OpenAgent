# Ralph Wiggum Loop: Codex CLI's `/goal` System

## What It Is

The `/goal` slash command in Codex CLI creates a thread-scoped objective. The runtime then enters a loop where it repeatedly auto-continues the agent with the prompt: **"Continue working toward your goal."** The model is expected to call `update_goal(status=complete)` when the work is done.

The user (or model) says `/goal Refactor the auth module`. The system replies: **"I'm helping!"** — and keeps "helping" until someone explicitly stops it.

---

## The Loop

### Step 1: Goal Creation

```
User: /goal Refactor the auth module
```

The runtime creates a `ThreadGoal` with:
- `objective`: "Refactor the auth module"
- `status`: `Active`
- `token_budget`: optional
- `tokens_used`: 0
- `time_used_seconds`: 0

### Step 2: The Agent Works

The model does some work — reads files, edits code, runs tests. Every tool call increments `tokens_used` and `time_used_seconds`.

### Step 3: Turn Ends

The model finishes its response. It does NOT call `update_goal(status=complete)` — either because:
- The work isn't actually done, or
- The model isn't confident enough to declare completion

### Step 4: The Runtime Says "Continue Working"

If no new user input is queued and the goal is still `Active`, the runtime **automatically injects** the continuation prompt:

```
Continue working toward the active thread goal.

<objective>
Refactor the auth module
</objective>

Continuation behavior:
- This goal persists across turns.
- Do not redefine success around a smaller or easier task.
- Temporary rough edges are acceptable.
```

### Step 5: The Model Says "I'm Helping!"

The model receives the prompt and does one of two things:

**Scenario A: More busywork**  
The model keeps working — maybe re-reads files, tweaks formatting, adds unnecessary refactors. It feels pressured by the prompt to "make concrete progress" and not "redefine success around a smaller task."

**Scenario B: Completion paralysis**  
The model tries to call `update_goal(status=complete)`, but the continuation prompt also includes a **brutal completion audit**:

```
Completion audit:
- Treat completion as unproven.
- For every explicit requirement, identify authoritative evidence.
- Treat tests, manifests, verifiers as evidence only after confirming coverage.
- Treat uncertain or indirect evidence as NOT achieved.
- The audit must PROVE completion, not merely fail to find obvious remaining work.
- Do not rely on intent, partial progress, memory of earlier work, or a plausible final answer as proof.
```

The model reads this and thinks: *"Actually, I haven't proven that every requirement is satisfied with authoritative evidence."*  
So it **doesn't** call `update_goal`. It goes back to Step 2.

### Step 6: Token Burn

The loop repeats. `tokens_used` climbs. If there was a `token_budget`, eventually:

```
The active thread goal has reached its token budget.

Wrap up this turn soon: summarize useful progress, identify remaining work or blockers.
```

The model is told to wrap up — but the prompt ALSO says:

```
Do not call update_goal unless the goal is actually complete.
```

So the model summarizes progress, identifies remaining work, and... the goal stays `Active`. The loop could theoretically continue if the user says something like "keep going."

---

## Why It's a Ralph Wiggum Loop

**Ralph Wiggum**: *"I'm helping!"*  
**The `/goal` system**: *"I'm continuing to work toward the active thread goal!"*

The model is trapped in a loop of "helping" because:

1. **The runtime is the cheerleader, not the coach.** It says "keep going!" but doesn't know whether the work is actually meaningful. It only knows whether `update_goal` was called.

2. **The completion audit is so paranoid that completion is almost impossible.** Treating "uncertain or indirect evidence as NOT achieved" means the model needs 100% certainty. Real-world refactoring never has 100% certainty.

3. **There's no intermediate checkpoint.** The model can't say "I've completed the file renames, now I need to update the tests." It has to either keep the goal `Active` or mark it `Complete`. There's no "partially complete" state that the model can set.

4. **Budget limits don't actually stop the goal.** They just tell the model to wrap up. The goal is still technically `Active` (status becomes `BudgetLimited`). The user has to manually clear or replace it.

5. **The model becomes a bureaucrat.** Instead of coding, it spends turns verifying that it's verified that it's verified the work. The completion audit template is **40% of the continuation prompt**.

---

## The Actual UX Problem

The user types `/goal Refactor the auth module` expecting the agent to be more autonomous. Instead they get:

- **Token burn** — the agent works for 5+ turns on what should have been 2.
- **Busywork** — the agent re-verifies already-verified changes because the prompt says "inspect the current state before relying on it."
- **Completion paralysis** — the agent never feels "done" enough to call `update_goal`.
- **Surprise budget exhaustion** — if a token budget was set, the agent suddenly pivots to "wrapping up" mid-task.

---

## What Codex CLI Gets Right

Despite the loop risks, the system is architecturally sound:

- **Goals survive interrupts** — if the user interrupts, the goal is `Paused`. On resume, the runtime prompts to continue.
- **Token/wall-clock tracking** is genuinely useful telemetry.
- **The completion audit** is a good guardrail against the model declaring victory prematurely.

The problem is **tuning**, not architecture. The completion audit is tuned for NASA mission-critical code, not everyday refactoring.

---

## Lessons for OpenAgent

If OpenAgent ever adds a goal system:

1. **Don't put the completion audit in the continuation prompt.** Let the model judge completion. Use runtime verification (test results, linter output) as hard evidence, not prompt guilt-tripping.

2. **Allow granular sub-goals or checkpoints.** The model should be able to say "I've completed Phase 1 (file renames)" without declaring the entire objective done.

3. **Auto-continuation should be gated on evidence, not just goal status.** Only continue if the last turn actually produced file changes or tool output. If the last turn was just "Let me think about this...", don't loop.

4. **Budget limits should pause, not just steer.** If the token budget is hit, the system should genuinely stop and ask the user for permission to continue, not just tell the model to "wrap up."

5. **The standing instruction is more important than the runtime loop.** Codex CLI's model updates its plan reliably because the instruction is **baked into the base system prompt**. The `/goal` runtime loop is a separate concept that should not be conflated with plan-update reliability.

---

## References

- `codex-rs/core/src/tools/handlers/goal_spec.rs` — Tool definitions (`create_goal`, `update_goal`, `get_goal`).
- `codex-rs/core/src/tools/handlers/goal/create_goal.rs` — Handler that creates the thread goal.
- `codex-rs/core/src/tools/handlers/goal/update_goal.rs` — Handler that marks goal complete. Only allows `status: "complete"`.
- `codex-rs/core/src/goals.rs` — Goal runtime: accounting, continuation logic, budget enforcement.
- `codex-rs/core/templates/goals/continuation.md` — The auto-continuation prompt template (brutal completion audit + "keep working" instruction).
- `codex-rs/core/templates/goals/budget_limit.md` — Budget steering prompt.
- `codex-rs/tui/src/app/thread_goal_actions.rs` — TUI slash command handling (`/goal <objective>`).
- `codex-rs/tui/src/slash_command.rs:115` — Slash command definition.
