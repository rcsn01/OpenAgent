# Implementation Plan

The work should land in the following order:

1. Extract reusable subagent execution from packages/opencode/src/tool/task.ts.
2. Add a dedicated SessionTaskGraph runtime service.
3. Migrate background_task and background_task_* management tools to the graph service using single-node graphs.
4. Add an explicit graph submission tool and graph management tools.
5. Add graph delivery using the existing parent-idle behavior.
6. Add lightweight prompt and TUI integration.
7. Add focused tests and package-local validation.

This order keeps the first refactor behavior-preserving, then replaces the flat background-task state with graph-backed state before layering multi-node submission on top of the same subagent-launch path the system already uses.

## Workstream 1: Extract Shared Subagent Execution

### Goal

Move the child-session creation and subagent execution logic out of packages/opencode/src/tool/task.ts so a graph node can launch long after the original tool call returned and so both blocking tasks and graph-backed background tasks share one execution path.

### Files

- packages/opencode/src/session/task-execution.ts
  - new reusable execution service
- packages/opencode/src/tool/task.ts
  - delegate execution to the new service
- packages/opencode/src/effect/app-runtime.ts
  - provide the new layer

### Responsibilities Of The New Service

The new TaskExecution service should own the logic that currently lives inside the task tool:

- resolving the target subagent from subagent_type
- performing or bypassing the permission check
- reusing an existing child session when task_id is provided
- creating a new child session when needed
- copying the caller's model when the subagent does not pin its own model
- resolving prompt parts through the existing prompt operations
- executing the child prompt through the existing prompt operations
- returning the same output shape the current task tool already emits

### Concrete Refactor Steps

1. Move the existing subagent execution path in task.ts into TaskExecution.
2. Keep task.ts responsible only for tool schemas, tool metadata, and choosing between blocking execution and later background graph submission.
3. Preserve the current task_id resume behavior and the current background-task output wording.
4. Preserve the current cancellation hook for blocking tasks.

### Acceptance Criteria

- task behavior is unchanged.
- background_task behavior is unchanged at the user surface.
- Existing task tool coverage still passes.
- No DAG logic is added in this step.

## Workstream 2: Add SessionTaskGraph

### Goal

Introduce a dedicated service that owns all background subagent state, including legacy one-off tasks and multi-node graphs.

### Files

- packages/opencode/src/session/task-graph.ts
  - new graph scheduler service
- packages/opencode/src/session/background-task.ts
  - remove it or reduce it to a compatibility adapter over SessionTaskGraph
- packages/opencode/src/effect/app-runtime.ts
  - provide the new layer
- packages/opencode/src/tool/registry.ts
  - add the service dependency because both background_task and graph tools will need it

### Responsibilities

The graph service should be responsible for:

- registering a whole graph at once
- registering single-node graphs for background_task
- validating node IDs and dependency edges before any work starts
- tracking pending, running, completed, failed, blocked, and cancelled node states
- launching runnable nodes
- blocking downstream pending nodes when a dependency fails or is cancelled
- tracking which completed nodes still need to be reported to the parent session
- indexing single-node graphs for legacy task lookups if compatibility needs it
- removing finished graphs from memory after all reporting is done

Runtime-only values such as prompt operations, permission callbacks, and delivery callbacks should stay outside the public graph record. They are needed for launching and delivering work, but they should not be part of the graph data returned by list and get operations.

### Registration Algorithm

Graph submission should do the following in order:

1. Reject an empty node list.
2. Validate duplicate node IDs, unknown dependencies, self-dependencies, and cycles.
3. Build the reverse dependency map once during registration.
4. Create all nodes in pending state.
5. Store graph metadata, including whether the graph came from background_task or explicit graph submission.
6. Store graph state and runtime context.
7. Trigger scheduling once after registration.
8. Return a summary that includes graph status and node summaries.

Legacy one-off background_task submissions should go through this same path with one generated node and an empty dependency list.

### Validation Rules

Submission must reject:

- duplicate node IDs
- unknown dependencies
- self-dependencies
- cycles
- empty graphs

Cycle detection should happen during registration, not during execution.

### Graph Status Rules

Use these rules consistently:

- active means at least one node is pending or running
- completed means every node completed successfully
- failed means no nodes remain pending or running and at least one node failed or was blocked
- cancelled means the graph was explicitly cancelled

## Workstream 3: Scheduling And Node Execution

### Goal

Launch runnable nodes concurrently, rely on the shared codebase as the handoff surface, and update graph state on completion.

### Readiness Rule

A node is runnable only when:

- its status is pending
- every dependency completed successfully

Failed, blocked, and cancelled dependencies stop the path.

### Scheduler Behavior

Scheduling should be event-driven and idempotent.

1. Load the graph.
2. Return immediately if the graph is missing or already terminal.
3. Guard against duplicate scheduling for the same graph.
4. Collect all runnable nodes.
5. Mark each runnable node as running before launching it.
6. Launch runnable nodes concurrently through the shared task execution service.
7. On node completion or failure, update state and trigger scheduling again.
8. Recompute graph status after each state transition.
9. Queue completed node reports for parent delivery.

### Node Launch Behavior

When a node launches:

1. The graph service starts a child session for the node through the shared task execution service.
2. Permission checks should not be repeated per node if they were already approved for the graph submission.
3. The node stores the child session reference and start time.
4. On success, the node is marked completed and stores its title, output, and completion time.
5. On failure, mark the node as failed, store the error, and propagate downstream blocking.
6. After either result, graph state is recomputed and scheduling runs again.

For background_task compatibility, the single node should become runnable immediately and launch during submission because it has no dependencies.

There is no dependency-output injection step in this design. Ordered tasks are expected to coordinate through repository state rather than through scheduler-generated prompt content.

### Failure And Blocking

Use cascade blocking for v1.

When a node fails:

1. mark the node as failed
2. walk transitive downstream dependents using the stored reverse dependency map
3. mark only pending downstream nodes as blocked
4. record which upstream node blocked them
5. leave already running or terminal nodes unchanged

Because multiple failed ancestors may converge on one node, the blocked reason should allow more than one upstream blocker.

### Graph Cancellation

The graph cancel tool should cancel the graph through the graph service.

Graph cancellation should:

1. suppress future automatic reporting for the graph
2. cancel every running child session through the existing session run-state service
3. mark pending nodes as cancelled
4. allow running nodes to settle into cancelled as their cancellation propagates
5. mark the graph as cancelled

Do not auto-deliver a synthetic reminder after explicit cancellation. The cancel tool response itself is the user-visible confirmation.

background_task_cancel should call this same graph-cancellation path for single-node graphs.

## Workstream 4: Delivery Back To The Parent Session

### Goal

Reuse the existing parent-idle delivery model while ensuring every completed node is eventually reported back to the parent assistant.

### Delivery Triggers

Delivery should become pending whenever a node completes successfully or fails.

If the parent session is busy when a node finishes, the report can wait until the parent session becomes idle. Multiple finished nodes can be delivered together if they pile up while the parent is busy.

### Delivery Gating

Mirror the existing one-off background-task behavior:

- subscribe to the parent idle event
- only flush when the parent session is idle
- also require the parent run-state to be not busy

### Delivery Payload

The graph delivery payload should include:

- graph identity
- overall graph status
- newly completed nodes with their outputs
- newly failed nodes with their errors
- any newly blocked nodes if that helps the parent explain why no further work will start

### Delivery Rendering

The delivery reminder should tell the parent assistant that one or more graph nodes finished, summarize the node results, and continue helping the user.

### Delivery Bookkeeping

After successful delivery:

- mark delivered node reports so they are not repeated
- mark final graph delivery once the graph reaches a terminal state and that final status has been surfaced
- remove the graph from memory only when it is terminal and has nothing left to deliver

This mirrors the existing one-off behavior where finished tasks disappear after successful delivery.

## Workstream 5: Tool Surface

### Keep background_task As A Compatibility Wrapper

Do not keep a separate one-off runtime in v1.

Instead:

- background_task stays the user-visible tool for standalone work
- background_task submits a graph with one generated node and no dependencies
- that single node launches immediately because it is runnable at registration time
- the tool keeps the same user-facing wording, but the backing state lives in the graph service

If compatibility needs a task-shaped identifier, the wrapper can return the launched child session reference in addition to the graph ID, but the graph service should remain the source of truth.

### Migrate Existing background_task Management Tools

Update packages/opencode/src/tool/background_task_manage.ts so that:

- background_task_list lists single-node graphs created through background_task
- background_task_get resolves a single-node graph and renders the existing task-centric shape
- background_task_cancel cancels the underlying graph

These tools should read from the graph service rather than a separate flat task store.

### Add background_task_graph

Create packages/opencode/src/tool/background_task_graph.ts as the graph submission tool.

Execution behavior:

1. Validate the input and normalize missing dependency lists to empty.
2. Ask for permission once for the distinct set of subagent types used by the graph.
3. Read the current assistant message, just like the existing task tool does today.
4. Build the graph delivery callback using the current assistant context and the existing prompt operations.
5. Submit the graph to the graph service.
6. Return a summary containing the graph ID, node statuses, runnable count, and waiting count.

### Add Graph Management Tools

Create packages/opencode/src/tool/background_task_graph_manage.ts with:

- background_task_graph_list
- background_task_graph_get
- background_task_graph_cancel

These tools should expose:

- graph status
- node statuses
- dependency edges
- optional child session references for launched nodes
- failure and blocked reasons
- graph timestamps

The output format should be graph-specific instead of overloading the existing one-off background task format.

### Register New Tools

Update packages/opencode/src/tool/registry.ts to:

- initialize the graph service, the background_task compatibility wrappers, and the graph tools
- add them to the builtin tool list
- include the graph service in layer requirements

Also update packages/opencode/src/cli/cmd/agent.ts so the tool names can be selected when creating agents.

## Workstream 6: Prompt And Diagram UI Integration

### Prompt Guidance

Update packages/opencode/src/session/prompt files to teach models when to prefer:

- background_task for one-off independent work that should launch immediately as a single-node graph
- background_task_graph for dependent work with explicit prerequisites

The prompt guidance should specifically discourage chaining multiple independent background tasks when the work actually requires ordering, because the scheduler cannot enforce dependencies unless the work is submitted as one graph.

The prompt guidance should also make the limitation explicit: downstream graph tasks are expected to inspect repository state instead of receiving injected summaries from upstream tasks.

### Diagram-First Requirement

A graph screen is only complete when it renders a real diagram.

That means:

- nodes occupy explicit positions in a 2D layout
- dependency edges are drawn explicitly between nodes
- the current session node and focus graph are visually highlighted
- textual summaries remain a secondary inspection surface, not the primary graph view

A wrapped list of nodes, an adjacency list, or a status table is useful as supporting detail, but it is not the graph diagram.

### Reuse The Existing Graph Endpoint

The current `/session/:sessionID/graphs` response already contains the structural data required for a diagram:

- graph identity and graph status
- node identity and node status
- dependency edges
- focus graph identity
- child session references for launched nodes

For v1, the display system should consume this existing payload directly instead of introducing a second diagram-specific API surface.

### Shared Diagram Pipeline

The diagram system should be split into four layers:

1. Graph response: the raw session graph payload from the API.
2. Diagram model: normalized nodes, edges, focus state, and interaction metadata.
3. Layout engine: deterministic node positions and routed edge paths.
4. Renderer adapter: client-specific drawing implementation.

This prevents the TUI, app, desktop, and web clients from each re-implementing graph semantics differently.

### Diagram Model

Add a shared pure TypeScript transformation from `SessionGraphsResponse` into a diagram-oriented shape such as:

- `DiagramGraph`
- `DiagramNode`
- `DiagramEdge`
- derived flags such as `isCurrent`, `isFocus`, `isBlocked`, and `hasSession`

Each node should carry only semantic data needed for layout and interaction, for example:

- stable node ID
- display label
- status
- agent label
- child session reference
- timestamps and error summary for the detail pane

The diagram model should not contain renderer-specific concerns like SVG elements, TUI characters, or canvas drawing commands.

### Layout Engine

Use a layered DAG layout as the default algorithm.

The layout pass should:

1. compute topological depth and use it as the base column placement
2. order siblings stably using dependency set, `createdAt`, and `nodeID`
3. assign rows to reduce crossings while keeping the output deterministic
4. route edges orthogonally and emit waypoints or polylines
5. preserve coordinates across refreshes when the graph shape has not changed

The output of the layout engine should be explicit node rectangles and edge paths, not pre-rendered text.

### Renderer Adapters

Use the same diagram model and layout output across all clients, with different renderers per surface:

- app, desktop, and web should be the primary diagram renderers and should draw actual boxes, arrows, hover states, and focus states using SVG or canvas
- the TUI should render a reduced-fidelity diagram from the same layout spec using box-drawing characters as a compatibility renderer
- textual node summaries should remain available below or beside the diagram as an inspection pane

This keeps diagram semantics shared while allowing clients with real 2D drawing support to present a substantially better graph view.

### Interaction Model

The diagram surface should support:

- selecting a node
- opening the child session for a launched node
- highlighting upstream and downstream dependencies for the selected node
- centering the current session node or focus graph when the view opens
- zoom-to-fit and reset-layout actions in graphical clients
- keeping the node detail pane synchronized with the current selection

### TUI Integration

Update packages/opencode/src/cli/cmd/tui/routes/session/index.tsx to render background work from graph state, with a dedicated graph-specific screen view that shows:

- graph status
- runnable, running, completed, failed, and blocked counts
- an actual box-and-edge diagram derived from the shared diagram model
- per-node status summaries in a secondary detail pane
- optional child session links when a node has launched

Single-node background_task submissions can keep the existing compact presentation, but they should still drill into the same graph-backed diagram view.

When the terminal is too narrow to show the whole layout cleanly, the TUI should degrade to a selected-node-focused miniature diagram plus the detail pane, not to a pure text-only graph screen.
