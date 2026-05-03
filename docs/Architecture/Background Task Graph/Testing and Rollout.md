# Testing and Rollout

## Test Plan

### New Or Expanded Test Files

- packages/opencode/test/session/task-graph.test.ts
  - graph validation and scheduler behavior, including single-node wrapper submissions
- packages/opencode/test/tool/background_task_manage.test.ts
  - compatibility views over graph-backed one-off tasks
- packages/opencode/test/tool/background_task_graph.test.ts
  - submit, list, get, and cancel tool behavior
- packages/opencode/test/tool/task.test.ts
  - confirm the TaskExecution extraction and background_task wrapper do not change existing tool behavior
- packages/opencode/test/tool/registry.test.ts
  - confirm new tools are registered
- packages/opencode/test/session/prompt.test.ts
  - confirm idle-gated delivery behavior if prompt-level delivery tests are the best fit there

### Minimum Test Cases

- empty graphs are rejected
- background_task submits a single-node graph and launches immediately
- background_task_list, background_task_get, and background_task_cancel operate against graph-backed one-off tasks
- duplicate node IDs are rejected
- self-dependencies are rejected
- missing dependencies are rejected
- cycles are rejected
- nodes with no dependencies launch immediately
- dependent nodes do not launch until all prerequisites complete
- downstream tasks start only after upstream tasks have had a chance to change repository state
- failed nodes block pending downstream nodes
- cancelled graphs suppress future automatic delivery
- graph delivery does not occur while the parent session is busy
- graph delivery occurs once the parent session becomes idle
- every completed or failed node is eventually reported to the parent session

### Validation Approach

Run focused tests for task execution extraction, graph scheduling, graph tool behavior, registry wiring, and prompt delivery. Run typecheck from the package directory, not the repo root.

## Rollout Plan

### Milestone 1

- land TaskExecution
- keep all existing task behavior unchanged
- verify current task tests still pass

### Milestone 2

- land SessionTaskGraph
- migrate background_task onto single-node graphs
- support validation, runnable-node launch, success, failure, blocking, and per-node delivery

### Milestone 3

- land background_task_graph
- land graph management tools
- land the shared diagram model and layout engine
- add diagram renderers for TUI and graphical clients
- improve graph summaries for failures and blocked nodes

### Deferred After V1

- durable restart recovery
- retries and retry policies
- animated layout transitions and manual re-layout controls
- cross-session or cross-project graphs
- node-level retry or resume commands

## Acceptance Checklist

The implementation is complete for v1 when all of the following are true:

- one-off background_task is graph-backed and its user-facing behavior is unchanged
- background_task_list, background_task_get, and background_task_cancel operate on graph-backed one-off tasks
- DAG submission validates the whole graph before any node launches
- nodes launch only after all dependencies complete
- downstream nodes rely on repository state instead of injected upstream outputs
- failures and cancellations block downstream pending nodes
- every completed or failed node is eventually reported to the parent session
- parent delivery still respects idle gating
- graph tools are visible in the registry and usable from agents
- the graph screen renders an explicit node-and-edge diagram rather than only textual summaries
- the same graph payload can drive both the TUI diagram and richer graphical client renderers
- package-local tests and typecheck pass

## Recommendation

The simplest viable implementation for OpenCode is a dedicated graph service plus a reusable subagent execution service, with every background task represented as a graph and with dependencies used only for ordering. background_task should remain as the lightweight one-off entry point, but it should create a single-node graph instead of writing to a separate flat task runtime. That keeps the current UX intact while collapsing execution onto one scheduling model and avoids adding a second prompt-level dependency transport system.
