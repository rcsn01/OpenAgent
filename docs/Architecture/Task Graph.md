# Task Graph

OpenAgent already supports background subagent execution, but the current runtime only tracks a flat set of independently launched tasks. The next version should move all background subagent work onto one graph runtime.

## Design Goals

- Support dependent background subagent work within a single parent session
- Unify one-off and dependent background work under one runtime
- Preserve current one-off `background_task` behavior at the user surface
- Keep scheduling independent from the main assistant loop
- Reject malformed graphs before any child session starts
- Rely on the shared codebase and files as the handoff surface between ordered tasks
- Display graph state as a real diagram with positioned nodes and explicit dependency edges

## Non-Goals

- Maintaining a separate flat background-task runtime beside graphs
- Passing upstream outputs into downstream prompts through a special dependency injection format
- Workflows that depend on reasoning never written to files or other durable state
- A generic workflow engine unrelated to subagent execution
- Textual node lists or adjacency lists as the primary graph display

## Simplified DAG Model

- Every background submission is a graph
- `background_task` creates a graph with one node and zero dependencies
- Dependencies define start order only
- A node with no dependencies can start immediately
- A node with dependencies stays pending until all prerequisites complete
- Downstream nodes do not receive injected dependency summaries
- Downstream nodes are expected to inspect the repository, files, and other durable state
- Failure or cancellation of a node blocks downstream pending nodes
- Graph cancellation suppresses further automatic reporting

## Current System Baseline

The relevant runtime today is centered on background subagent sessions:

- `packages/openagent/src/tool/task.ts` — launches child subagent sessions for each `background_task` call and forks execution
- `packages/openagent/src/session/background-task.ts` — stores per-parent task state in InstanceState, tracks running/completed/failed tasks, flushes finished results into the parent session when idle
- `packages/openagent/src/tool/background_task_manage.ts` — exposes list, get, and cancel tools assuming a flat task model

Key limitations:
- No notion of a pending node that exists before launch
- No dependency graph or cycle validation
- Tasks identified by child session ID created at launch time
- State is in-memory only, does not survive process restart

## State and Invariants

### Invariants (v1)

- Every background task belongs to exactly one graph
- `background_task` submits a graph with one node and zero dependencies
- A node may declare zero or more dependencies
- Graph submission is all-or-nothing; validation failure creates no child sessions
- A node launches only when every dependency is completed
- A failed or cancelled prerequisite blocks downstream pending nodes
- Every completed or failed node becomes reportable to the parent session
- Delivery waits for the parent session to become idle (existing behavior)
- DAG state remains in memory only
- Explicit graph cancellation suppresses future automatic reporting

### Node State Transitions

- `pending -> running` when all dependencies completed and scheduler launches the node
- `running -> completed` when the child session finishes successfully
- `running -> failed` when the child session finishes with an error
- `pending -> blocked` when an upstream dependency fails or is cancelled
- `pending -> cancelled` when the whole graph is explicitly cancelled before launch

Completed, failed, blocked, and cancelled are terminal in v1.

### Graph State Transitions

- `active -> completed` when every node completed successfully
- `active -> failed` when no nodes remain pending/running and at least one node failed or was blocked
- `active -> cancelled` when graph cancellation is invoked

## Implementation Plan

The work should land in this order:

1. Extract reusable subagent execution from `task.ts`
2. Add a dedicated `SessionTaskGraph` runtime service
3. Migrate `background_task` and management tools to the graph service using single-node graphs
4. Add explicit graph submission tool and graph management tools
5. Add graph delivery using existing parent-idle behavior
6. Add lightweight prompt and TUI integration
7. Add focused tests and package-local validation

### Workstream 1: Extract Shared Subagent Execution

Move the child-session creation and execution logic out of `task.ts` into a new `TaskExecution` service (`packages/openagent/src/session/task-execution.ts`).

The service owns:
- Resolving the target subagent from `subagent_type`
- Performing or bypassing permission checks
- Reusing existing child sessions when `task_id` is provided
- Creating new child sessions
- Copying the caller's model when the subagent doesn't pin its own
- Resolving prompt parts through prompt operations
- Executing the child prompt

### Workstream 2: Add SessionTaskGraph

Introduce a dedicated graph scheduler service (`packages/openagent/src/session/task-graph.ts`) that owns all background subagent state.

Responsibilities:
- Registering whole graphs at once
- Registering single-node graphs for `background_task`
- Validating node IDs and dependency edges before work starts
- Tracking pending, running, completed, failed, blocked, and cancelled states
- Launching runnable nodes
- Blocking downstream nodes when dependencies fail
- Tracking completed nodes pending parent delivery

### Validation Rules

Submission must reject: duplicate node IDs, unknown dependencies, self-dependencies, cycles, empty graphs. Cycle detection happens during registration, not execution.

### Workstream 3: Scheduling and Node Execution

A node is runnable only when its status is `pending` and every dependency completed successfully. Failed, blocked, and cancelled dependencies stop the path.

The scheduler is event-driven and idempotent:
1. Load the graph, return immediately if missing or terminal
2. Guard against duplicate scheduling
3. Collect all runnable nodes, mark each as running before launch
4. Launch runnable nodes concurrently through TaskExecution
5. On completion or failure, update state and trigger scheduling again
6. Recompute graph status after each transition
7. Queue completed node reports for parent delivery

**Failure cascade:** When a node fails, mark pending downstream nodes as blocked using the reverse dependency map. Running or terminal nodes are left unchanged.

**Graph cancellation:** Suppress future automatic reporting, cancel every running child session through the session run-state service, mark pending nodes as cancelled.

### Workstream 4: Delivery Back to the Parent Session

Delivery becomes pending whenever a node completes or fails. If the parent is busy, the report waits until the parent becomes idle. Multiple finished nodes can be delivered together.

Delivery gating mirrors existing behavior: subscribe to parent idle event, only flush when parent is idle and run-state is not busy.

The payload includes: graph identity, overall graph status, newly completed nodes with outputs, newly failed nodes with errors, newly blocked nodes.

After delivery: mark delivered reports so they aren't repeated, remove the graph from memory only when terminal with nothing left to deliver.

### Workstream 5: Tool Surface

- `background_task` stays as a compatibility wrapper submitting single-node graphs
- Existing management tools (`background_task_list`, `background_task_get`, `background_task_cancel`) read from the graph service
- New `background_task_graph` tool for multi-node submissions with dependency edges
- New graph management tools (`background_task_graph_list`, `background_task_graph_get`, `background_task_graph_cancel`)

### Workstream 6: Prompt and Diagram UI

**Prompt guidance** in `session/prompt` files teaches models when to use `background_task` (one-off) vs `background_task_graph` (dependent work).

**Diagram-first requirement:** A graph screen renders a real diagram with positioned nodes and drawn edges. The system is split into four layers:
1. Graph response (raw session graph payload from API)
2. Diagram model (normalized nodes, edges, focus state)
3. Layout engine (deterministic layered DAG layout with orthogonal edge routing)
4. Renderer adapter (SVG/canvas for graphical clients, box-drawing for TUI)

## Testing and Rollout

### Test Files

- `packages/openagent/test/session/task-graph.test.ts` — graph validation and scheduler behavior
- `packages/openagent/test/tool/background_task_manage.test.ts` — compatibility views over graph-backed tasks
- `packages/openagent/test/tool/background_task_graph.test.ts` — submit, list, get, cancel behavior
- `packages/openagent/test/tool/task.test.ts` — TaskExecution extraction behavior preservation
- `packages/openagent/test/tool/registry.test.ts` — new tool registration
- `packages/openagent/test/session/prompt.test.ts` — idle-gated delivery

### Minimum Test Cases

- Empty graphs rejected; single-node graphs launch immediately
- Duplicate IDs, self-dependencies, missing dependencies, cycles all rejected
- Dependent nodes don't launch until prerequisites complete
- Failed nodes block downstream pending nodes
- Cancelled graphs suppress future automatic delivery
- Graph delivery gated by parent-idle; every completed/failed node reported

### Rollout Milestones

1. Land TaskExecution, keep existing behavior unchanged
2. Land SessionTaskGraph, migrate background_task onto single-node graphs
3. Land background_task_graph, graph management tools, shared diagram model, TUI/graphical renderers

**Deferred after v1:** durable restart recovery, retries, animated layout transitions, cross-session graphs, node-level retry or resume.

### Acceptance Checklist for v1

- One-off background_task is graph-backed, user behavior unchanged
- DAG submission validates before any node launches
- Nodes launch only after all dependencies complete
- Downstream nodes rely on repository state, not injected outputs
- Failures/cancellations block downstream pending nodes
- Every completed/failed node reported to parent (idle-gated)
- Graph tools visible in registry and usable from agents
- Graph screen renders explicit node-and-edge diagram
- Same graph payload drives TUI and graphical client renderers
- Package-local tests and typecheck pass
