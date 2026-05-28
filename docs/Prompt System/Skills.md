# Skills

## Overview

Skills are another instruction layer that provides specialized instructions and workflows for specific tasks. They are discovered at runtime, loaded as markdown files with frontmatter, and summarized in the system prompt.

## Discovery

Skills are discovered in `packages/openagent/src/skill/index.ts` from multiple sources:

1. **Global external skills** (unless disabled):
   - `~/.claude/skills/**/SKILL.md` (if `OPENAGENT_DISABLE_CLAUDE_CODE_SKILLS` is off)
   - `~/.agents/skills/**/SKILL.md`

2. **Project external skills** (searched upward from directory to worktree):
   - `.claude/skills/**/SKILL.md`
   - `.agents/skills/**/SKILL.md`

3. **Config directories**:
   - `skill/**/SKILL.md` and `skills/**/SKILL.md` inside each configured directory

4. **Explicit paths** (from `openagent.json`):
   - `skills.paths` — directories to scan for `**/SKILL.md`
   - `skills.urls` — remote URLs that get pulled and scanned

## Loading

Each `SKILL.md` must have frontmatter with `name` and `description`:

```yaml
---
name: effect
---
```

The skill content is parsed and the full markdown body is stored as `content`. Duplicate names are warned and the first-loaded wins.

## Skill Tool

The model gets a summary of available skills in system context, then decides whether to load a specific skill. Skills are loaded via the `skill` tool call.

## Formatting

The skill summary is formatted in `packages/openagent/src/skill/index.ts`:

- **Verbose** (in the system prompt): XML-style `<available_skills>` with `<skill>` blocks containing name, description, and file location
- **Brief** (in tool description): Markdown list with `**name**: description`

## Permission Control

Agents can control which skills they can see via permissions. The `available` method filters skills:

```ts
list.filter((skill) =>
  Permission.evaluate("skill", skill.name, agent.permission).action !== "deny"
)
```

## Related Files

- `packages/openagent/src/skill/index.ts` — discovery, loading, formatting
- `packages/openagent/src/tool/skill.ts` — runtime skill invocation
