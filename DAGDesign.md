# Background Task Graph Design

## Summary

OpenCode already supports background subagent execution, but the current runtime only tracks a flat set of independently launched tasks. The next version should move all background subagent work onto one graph runtime instead of keeping a flat background-task system beside a DAG system.

The simplified design is:

- Represent every background submission as a graph.
- Keep the current background_task tool for independent work, but implement it as a single-node graph with no dependencies.
- Use background_task_graph only when the caller needs to submit multiple nodes or explicit dependency edges.
- Treat dependencies as ordering only, not as a mechanism for passing outputs between subagents.
- Let downstream subagents work from the shared codebase and files, not injected upstream results.
- Report every completed graph node back to the main agent, using the existing parent-idle delivery behavior.
- Keep DAG state in memory for v1.

This simplification is reasonable if graph nodes coordinate through repository state, edited files, and other durable side effects. If a workflow depends on unstored reasoning that exists only in a subagent response and is not written anywhere the next subagent can inspect, that workflow is out of scope for this first version.

## Current System Baseline

The relevant runtime today is centered on background subagent sessions:

- packages/opencode/src/tool/task.ts launches a child subagent session immediately for each background_task call and forks execution in the background.
- packages/opencode/src/session/background-task.ts stores per-parent background task state in InstanceState, tracks running, completed, and failed tasks, and flushes finished task results back into the parent session when that parent session is idle.
- packages/opencode/src/tool/background_task_manage.ts exposes background_task_list, background_task_get, and background_task_cancel, all of which assume a flat task model keyed by launched task ID.

What this means in practice:

- There is no notion of a pending node that exists before launch.
- There is no dependency graph or cycle validation.
- A task is identified by the child session ID created at launch time.
- Completed task results are delivered back to the parent conversation automatically.
- State is in memory only and does not survive process restart.

Those constraints matter because the unified graph runtime needs stable graph and node identities before execution begins, needs to represent nodes that are waiting on dependencies, and should avoid keeping a second flat registry in sync with graph state. One-off background tasks should become single-node graphs that launch immediately.

## Child Sessions In This System

A child session is the subagent's own session created under the main session.

- It has its own message history, run state, tool calls, and status.
- It is linked to the parent session so the main assistant can treat it as delegated work.
- Every background task belongs to a graph, even when that graph has only one node.
- The parent can keep working while the child session runs in the background.
- The TUI already treats these as subagent sessions.

For graph-backed background work, child sessions should be used in the same way, with one important difference:

- A single-node background task graph should launch its only node immediately so the current one-off UX stays intact.
- A graph node should get a child session only when it becomes runnable.
- Pending graph nodes should exist before launch but should not have child sessions yet.
- Running, completed, failed, and cancelled graph nodes may reference the child session that executed them.

## Design Goals

- Support dependent background subagent work within a single parent session.
- Unify one-off and dependent background work under one runtime.
- Preserve current one-off background_task behavior at the user surface.
- Keep scheduling independent from the main assistant loop.
- Reject malformed graphs before any child session starts.
- Keep the first version simple enough to implement without a second coordination channel between subagents.
- Rely on the shared codebase and files as the handoff surface between ordered tasks.

## Non-Goals

- Maintaining a separate flat background-task runtime beside graphs.
- Passing upstream outputs into downstream prompts through a special dependency injection format.
- Supporting workflows that depend on reasoning that is never written to files or other durable state.
- Introducing a generic workflow engine unrelated to subagent execution.

## Simplified DAG Model

- Every background submission is a graph.
- background_task creates a graph with one node and zero dependencies.
- Dependencies define start order only.
- A node with no dependencies can start immediately.
- A node with dependencies stays pending until all prerequisites complete.
- A node completion should always become reportable to the main agent.
- If the parent session is busy, completed node reports can wait and then be delivered in a batch once the parent becomes idle.
- Downstream nodes do not receive injected dependency summaries.
- Downstream nodes are expected to inspect the repository, files, and other durable state created by earlier work.
- Failure or cancellation of a node blocks downstream pending nodes.
- Graph cancellation suppresses further automatic reporting for that graph.

This makes the graph model much simpler. The graph is responsible for validation, readiness, launching, failure handling, cancellation, parent delivery, and compatibility with one-off background tasks. It is not responsible for translating one subagent's reasoning into the next subagent's prompt.

## Implementation Principles

- Replace the existing flat background-task registry with graph-backed state instead of running both models.
- Extract reusable subagent execution first, then build graph scheduling on top of it.
- Use graph IDs as the stable identity for all background work.
- Use node IDs as the stable identity within a graph.
- Use child session IDs only after a node actually launches.
- Keep scheduling event-driven instead of polling.
- Keep one-off background task tools as backward-compatible views over the graph runtime.
- Keep the first implementation scoped to the current in-process runtime.

## Detailed Implementation Plan

The work should land in the following order:

1. Extract reusable subagent execution from packages/opencode/src/tool/task.ts.
2. Add a dedicated SessionTaskGraph runtime service.
3. Migrate background_task and background_task_* management tools to the graph service using single-node graphs.
4. Add an explicit graph submission tool and graph management tools.
5. Add graph delivery using the existing parent-idle behavior.
6. Add lightweight prompt and TUI integration.
7. Add focused tests and package-local validation.

This order keeps the first refactor behavior-preserving, then replaces the flat background-task state with graph-backed state before layering multi-node submission on top of the same subagent-launch path the system already uses.

## Invariants To Lock Before Coding

These are the rules the implementation should treat as fixed for v1:

- Every background task belongs to exactly one graph.
- background_task submits a graph with one node and zero dependencies.
- A node may declare zero or more dependencies.
- Graph submission is all-or-nothing. If validation fails, no child session is created.
- A node launches only when every dependency is completed.
- A failed or cancelled prerequisite blocks downstream pending nodes.
- Every completed or failed node becomes reportable to the parent session.
- Delivery still waits for the parent session to become idle, matching the existing runtime.
- DAG state remains in memory only for v1.
- Explicit graph cancellation suppresses future automatic reporting for that graph.

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

## Workstream 6: Prompt And UI Integration

### Prompt Guidance

Update packages/opencode/src/session/prompt files to teach models when to prefer:

- background_task for one-off independent work that should launch immediately as a single-node graph
- background_task_graph for dependent work with explicit prerequisites

The prompt guidance should specifically discourage chaining multiple independent background tasks when the work actually requires ordering, because the scheduler cannot enforce dependencies unless the work is submitted as one graph.

The prompt guidance should also make the limitation explicit: downstream graph tasks are expected to inspect repository state instead of receiving injected summaries from upstream tasks.

### TUI Integration

Update packages/opencode/src/cli/cmd/tui/routes/session/index.tsx to render background work from graph state, with a dedicated graph-specific screen view that shows:

- graph status
- runnable, running, completed, failed, and blocked counts
- per-node status summaries
- optional child session links when a node has launched

Single-node background_task submissions can keep the existing compact presentation, but they should still drill into the same graph-backed detail view.

## State Transition Table

### Node Transitions

- pending to running when all dependencies completed and the scheduler launches the node
- running to completed when the child session finishes successfully
- running to failed when the child session finishes with an error
- pending to blocked when an upstream dependency fails or is cancelled
- pending to cancelled when the whole graph is explicitly cancelled before the node launches

Completed, failed, blocked, and cancelled are terminal in v1.

### Graph Transitions

- active to completed when every node completed successfully
- active to failed when no nodes remain pending or running and at least one node failed or was blocked
- active to cancelled when graph cancellation is invoked

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
- add lightweight TUI integration
- improve graph summaries for failures and blocked nodes

### Deferred After V1

- durable restart recovery
- retries and retry policies
- richer DAG visualization
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
- package-local tests and typecheck pass

## Recommendation

The simplest viable implementation for OpenCode is a dedicated graph service plus a reusable subagent execution service, with every background task represented as a graph and with dependencies used only for ordering. background_task should remain as the lightweight one-off entry point, but it should create a single-node graph instead of writing to a separate flat task runtime. That keeps the current UX intact while collapsing execution onto one scheduling model and avoids adding a second prompt-level dependency transport system.
