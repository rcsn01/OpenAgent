# Subagent Graph Panel and Prompt Updates

Implementation notes for the subagent graph UX and related assistant prompt changes.

## What Changed

### Expandable Graph Groups

The Subagents side panel now renders each graph as a clickable header.

- Graph rows start compact by default.
- Clicking a graph header expands or compacts that graph's child node list.
- The header exposes `aria-expanded` and uses chevron icons to show state.
- Expanded state is local UI state keyed by graph id.

Main file:

- `packages/app/src/pages/session/side-panel/subagents/index.tsx`

### Completed Graph Retention

Completed background task graphs are kept in `SessionTaskGraph` after their final delivery.

Before this change, `cleanupGraph` deleted terminal graphs once pending delivery was empty. The `/session/{sessionID}/graphs` endpoint then returned no graph records, so child sessions that had belonged to the completed graph appeared under `Ungrouped`.

Now terminal graph records remain queryable so the GUI can keep the original grouping visible after the task finishes.

Main file:

- `packages/opencode/src/session/task-graph.ts`

Key behavior:

- Active graphs and graphs with pending delivery still keep their delivery callback.
- Once there are no active graphs and no pending deliveries for a parent session, only the parent delivery callback is released.
- The graph record itself remains in memory for display and lookup.

### Newest Graphs First

Graph lists now prefer newest-first ordering.

- `SessionTaskGraph.list()` sorts by descending `createdAt`.
- The app model also sorts the response newest-first defensively.
- Default selection falls back to the newest graph when no focused graph is supplied.

Main files:

- `packages/opencode/src/session/task-graph.ts`
- `packages/app/src/pages/session/side-panel/subagents/model.ts`

### Web Tool Guidance

Agent-facing tool instructions now steer agents away from the failing first `WebFetch` pattern.

Updated guidance:

- Use `websearch` for search queries.
- Use `webfetch` only for specific URLs.
- `WebFetch` format must be `markdown`, `text`, or `html`.
- Never pass `json` as a `WebFetch` format, even for JSON API endpoints.
- Do not fetch Google or DuckDuckGo result pages just to search the web.

Main files:

- `packages/opencode/src/tool/webfetch.txt`
- `packages/opencode/src/tool/task.txt`
- `packages/opencode/src/tool/background_task.txt`
- `packages/opencode/src/tool/background_task_graph.txt`
- `packages/opencode/src/session/prompt/beast.txt`
- `packages/opencode/src/session/prompt/copilot-gpt-5.txt`

### WebFetch HTML Text Fix

`WebFetch` was also failing at runtime with `HTMLRewriter is not defined` when fetching HTML as text. The tool was using a Cloudflare-style `HTMLRewriter` global that is not available in the local Bun runtime.

The fix replaces that dependency with local HTML text extraction:

- remove script/style-like content
- convert common block tags to line breaks
- strip remaining tags
- decode common HTML entities

Main files:

- `packages/opencode/src/tool/webfetch.ts`
- `packages/opencode/test/tool/webfetch.test.ts`

### Minimal Subagent Completion Updates

Synthetic reminders delivered to the main assistant after background subagents finish now ask the assistant to think through next steps and avoid verbose user updates.

New behavior:

- Think about whether the result changes the next action.
- Continue working if action is needed.
- Do not give intermediate graph or node progress reports.
- If updating the user for completion, only say `Task <name> completed.` or `Task <name> failed.`
- Do not include bullets, headings, per-node details, dependency status, output summaries, or promises to update again unless the user explicitly asked for those details.

Main files:

- `packages/opencode/src/tool/background_task.ts`
- `packages/opencode/src/tool/background_task_graph.ts`

## Tests

Focused coverage was added for:

- Newest-first app graph ordering and default selection.
- Completed delivered graphs remaining grouped and queryable.
- Newest-first server graph ordering.

Test files:

- `packages/app/src/pages/session/side-panel/subagents/model.test.ts`
- `packages/opencode/test/session/task-graph.test.ts`

Verification commands run from package directories:

- `bun test --preload ./happydom.ts ./src/pages/session/side-panel/subagents/model.test.ts`
- `bun test test/session/task-graph.test.ts`
- `bun typecheck` in `packages/app`
- `bun typecheck` in `packages/opencode`

## Related Source Files

| File | Role |
|------|------|
| `packages/app/src/pages/session/side-panel/subagents/index.tsx` | Subagents side panel UI, compact/expanded graph state |
| `packages/app/src/pages/session/side-panel/subagents/model.ts` | Converts graph API response into panel groups, sorting, default selection |
| `packages/opencode/src/session/task-graph.ts` | In-memory graph lifecycle, retention, listing, delivery cleanup |
| `packages/opencode/src/tool/background_task.ts` | Synthetic delivery reminder for one-off background subagents |
| `packages/opencode/src/tool/background_task_graph.ts` | Synthetic delivery reminder for graph-backed background subagents |
| `packages/opencode/src/tool/webfetch.txt` | Tool-facing web fetch guidance |
| `packages/opencode/src/tool/task.txt` | Delegation guidance for synchronous subagents |
| `packages/opencode/src/tool/background_task.txt` | Delegation guidance for background subagents |
| `packages/opencode/src/tool/background_task_graph.txt` | Delegation guidance for graph-backed subagents |
