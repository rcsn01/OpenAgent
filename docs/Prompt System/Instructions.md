# Instructions (AGENTS.md)

## What They Are

`AGENTS.md` and related instruction files are **appended** as extra system context after the base prompt. They do not replace provider prompts or agent prompts.

## Files That Are Checked

The instruction loader (`external opencode runtime/src/session/instruction.ts`) looks for these files:

1. Project-level (searched upward from current directory to worktree root):
   - `AGENTS.md`
   - `CLAUDE.md` (unless `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` flag is set)
   - `CONTEXT.md` (deprecated)

2. Global config:
   - `~/.config/opencode/AGENTS.md`
   - `~/.claude/CLAUDE.md` (fallback)

3. Extra instruction files from `opencode.json`:
   - `config.instructions` — list of file paths or remote URLs
   - Remote URLs prefixed with `https://` or `http://` are fetched and cached

## Priority Rule

The **first project-level match wins** so we don't stack `AGENTS.md`/`CLAUDE.md` from every ancestor directory.

## Dynamic File-Walk Rules

When the assistant reads a file, `instruction.ts` walks upward from that file's directory and attaches nearby instruction files **once per message**. This means a subdirectory with its own `AGENTS.md` can provide localized rules for that part of the codebase.

The logic:

```ts
// Walk upward from the file being read and attach nearby instruction files once per message
while (current.startsWith(root) && current !== root) {
  const found = yield* find(current)
  if (!found || found === target || sys.has(found) || already.has(found)) {
    current = path.dirname(current)
    continue
  }
  // ... attach to message
}
```

## Remote Instructions

URLs in `config.instructions` are fetched with:
- 5-second timeout
- Transient retry on read errors
- `Effect.forEach` with concurrency of 4

## Format in Final Prompt

Each instruction file is formatted as:

```
Instructions from: <filepath>
<content>
```

Remote URLs use the URL in place of the filepath.

## Key Takeaway

`AGENTS.md` builds on top of the selected base prompt. It does not replace the provider prompt or custom agent prompt in the code path we inspected.
