---
name: git-commit
description: Write concise, well-structured git commit messages from code diffs, following this repo's conventions.
---

# Git Commit

Use this skill when the user asks you to commit changes, write a commit message, or summarize uncommitted work.

## Process

1. **Read the diffs first.** Use `git status`, `git diff`, and `git diff --cached` to see what changed. Use `git log --oneline -10` to match the repo's commit style.
2. **Stage files explicitly.** Never use `git commit -a` unless the user says so. Stage only the files relevant to the change.
3. **Write the message.** Follow the format below. If the user wants to review first, write the message as a proposal.

## Commit Message Format

```
{imperative verb} {what changed, not why}

{1-3 sentences explaining why. Focus on motivation and behavior, not file lists.}
```

### Subject line rules
- Use present-tense imperative: "Add", "Fix", "Update", "Remove", "Refactor", "Move" — not "Added" or "Fixes"
- 50-72 characters max
- No trailing period
- Describe the change, not the files

### Body rules
- Separate from subject with a blank line
- Explain what problem this solves and the behavioral effect
- If a change is non-obvious, justify it briefly
- Use bullet points (with `-`) only for lists of distinct sub-changes
- Do not list filenames or line counts unless the diff is enormous and needs signposting

### Examples

Good:
```
Grant blocking task to build, require existing session for send_message

Previously only assistant could spawn subagents. Now build can use
blocking task, enabling parallel synchronous work in coding sessions.
send_message no longer creates child sessions automatically — it
requires an existing session matched by task_id or newest child title.
```

Bad:
```
Updated agent.ts, registry.ts, send_message.ts, and 10 other files

- Changed agent.ts line 94
- Changed registry.ts line 75
...
```

## Safety

- Never commit `.env`, credentials, tokens, or secrets. Warn the user if they request it.
- Never amend commits that have been pushed unless the user explicitly requests it.
- Never use `--no-verify` or skip hooks unless the user asks.
- After committing, verify with `git status` that the working tree is clean.

## After the commit

Run `git status` to confirm success. Do not push unless the user asks.
