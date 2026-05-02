# Provider Prompt Catalog

## anthropic.txt

**Target**: Anthropic Claude models
**Size**: 105 lines

Tone focus:
- Professional objectivity — prioritize accuracy over validation
- Todo tracking — mandatory, frequent use of TodoWrite tool
- Task tool usage — proactive Task tool use for exploration
- Tool usage policy — one specialized tool per step, never chain bash with separators
- Code references — always include `file_path:line_number`

## beast.txt

**Target**: GPT-4 / o1 / o3 family
**Size**: 147 lines

Purpose: Autonomous problem-solving agents that work independently

Key directives:
- Thorough thinking, lengthy but avoiding repetition
- Iterate until problem is completely solved
- **Must** use `webfetch` to verify understanding (training is outdated)
- Recursive link following from web results
- Sequential thinking tool for complex problems
- Extensive testing and verification
- Todo tracking with checklists
- Never end turn without complete solution

## codex.txt

**Target**: OpenAI Codex
**Size**: 79 lines

Key directives:
- ASCII-only editing, minimal comments
- `apply_patch` preferred for single-file edits
- Parallel tool calls strongly encouraged
- Git hygiene — never revert others' changes
- Frontend design — avoid bland layouts, expressive typography
- Final answer structure — concise, scannable, use structure only when helpful

## copilot-gpt-5.txt

**Target**: Copilot GPT-5
**Size**: 143 lines

Covers Copilot-specific conventions.

## default.txt

**Target**: Catch-all (Cursor, generic providers)
**Size**: 105 lines

Balanced general-purpose prompt:
- Conciseness paramount (< 4 lines unless detail requested)
- Proactiveness with user consent
- Code conventions matching existing codebase
- No comments unless asked
- Task management and verification
- Tool usage with parallel optimization
- Git safety rules

## gemini.txt

**Target**: Google Gemini
**Size**: 155 lines

Structured guidance with separate sections:
- Core mandates (conventions, library verification, style)
- Primary workflows (software engineering + new applications)
- Operational guidelines (tone, security, tool usage)
- Explicit examples illustrating workflow

## gpt.txt

**Target**: OpenAI GPT (non-reasoning)
**Size**: 107 lines

Senior-engineer persona:
- Pragmatic, direct software engineer
- Autonomy and persistence — carry through to completion
- Parallelize tool calls extensively
- Editing minimalism — smallest correct changes
- Formatting rules (nested bullets forbidden, flat lists)
- Response channels: `commentary` for progress, `final` for completion

## kimi.txt

**Target**: Moonshot Kimi
**Size**: 95 lines

Focus:
- AGENTS.md awareness (explains what AGENTS.md is and why it exists)
- Coding guidelines (understand before changing, minimal changes)
- Project info (working directory, platform, today's date)
- KISS principle emphasis
- No git commits unless explicitly asked

## max-steps.txt

**Target**: Injected when agent has step limit
**Size**: 15 lines

Simple reminder that the agent has a maximum step limit before forcing text-only response.

## plan-reminder-anthropic.txt

**Target**: Claude in plan mode
**Size**: 67 lines

Reminds the agent about the plan mode distinction (high-level planning vs task execution).

## plan.txt

**Target**: General plan mode
**Size**: 26 lines

Core distinction: planning phase vs task execution phase.

## trinity.txt

**Target**: Trinity
**Size**: 97 lines

Similar to `default.txt` but with:
- One-tool-per-message restriction
- Question tool for clarifying vague requests
- Strict conciseness enforcement
