# DAG Background Task Design

## Summary

OpenCode already supports background subagent execution, but the current runtime only tracks a flat set of independently launched tasks. DAG support should add dependency-aware scheduling for background subagents without changing the core user experience for existing one-off background tasks.

The simplified design is:

- Keep the current background_task tool for independent work.
- Add a separate graph submission path for dependent work.
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

Those constraints matter because a DAG needs stable node identities before execution begins, needs to represent nodes that are waiting on dependencies, and should usually avoid auto-delivering every intermediate node result back into the parent assistant.

## Child Sessions In This System

A child session is the subagent's own session created under the main session.

- It has its own message history, run state, tool calls, and status.
- It is linked to the parent session so the main assistant can treat it as delegated work.
- For one-off background tasks, the child session ID is the task ID that gets returned and tracked.
- The parent can keep working while the child session runs in the background.
- The TUI already treats these as subagent sessions.

For DAGs, child sessions should be used in the same way, with one important difference:

- A graph node should get a child session only when it becomes runnable.
- Pending graph nodes should exist before launch but should not have child sessions yet.
- Running, completed, failed, and cancelled graph nodes may reference the child session that executed them.

## Design Goals

- Support dependent background subagent work within a single parent session.
- Preserve current one-off background_task behavior.
- Keep scheduling independent from the main assistant loop.
- Reject malformed graphs before any child session starts.
- Keep the first version simple enough to implement without a second coordination channel between subagents.
- Rely on the shared codebase and files as the handoff surface between ordered tasks.

## Non-Goals

- Replacing the existing background_task tool for simple independent work.
- Making DAG state durable in the initial implementation.
- Passing upstream outputs into downstream prompts through a special dependency injection format.
- Supporting workflows that depend on reasoning that is never written to files or other durable state.
- Introducing a generic workflow engine unrelated to subagent execution.

## Simplified DAG Model

- Dependencies define start order only.
- A node with no dependencies can start immediately.
- A node with dependencies stays pending until all prerequisites complete.
- A node completion should always become reportable to the main agent.
- If the parent session is busy, completed node reports can wait and then be delivered in a batch once the parent becomes idle.
- Downstream nodes do not receive injected dependency summaries.
- Downstream nodes are expected to inspect the repository, files, and other durable state created by earlier work.
- Failure or cancellation of a node blocks downstream pending nodes.
- Graph cancellation suppresses further automatic reporting for that graph.

This makes the graph model much simpler. The graph is only responsible for validation, readiness, launching, failure handling, cancellation, and parent delivery. It is not responsible for translating one subagent's reasoning into the next subagent's prompt.

## Implementation Principles

- Do not overload the existing flat background task registry with pending graph nodes.
- Extract reusable subagent execution first, then build graph scheduling on top of it.
- Use graph IDs and node IDs as the stable graph identity model.
- Use child session IDs only after a node actually launches.
- Keep scheduling event-driven instead of polling.
- Keep one-off background task tools backward-compatible.
- Keep the first implementation scoped to the current in-process runtime.

## Detailed Implementation Plan

The work should land in the following order:

1. Extract reusable subagent execution from packages/opencode/src/tool/task.ts.
2. Add a dedicated SessionTaskGraph runtime service.
3. Add a graph submission tool and graph management tools.
4. Add graph delivery using the existing parent-idle behavior.
5. Add lightweight prompt and TUI integration.
6. Add focused tests and package-local validation.

This order keeps the first refactor behavior-preserving, then layers DAG scheduling on top of the same subagent-launch path the system already uses.

## Invariants To Lock Before Coding

These are the rules the implementation should treat as fixed for v1:

- A node may declare zero or more dependencies.
- Graph submission is all-or-nothing. If validation fails, no child session is created.
- A node launches only when every dependency is completed.
- A failed or cancelled prerequisite blocks downstream pending nodes.
- Every completed node becomes reportable to the parent session.
- Delivery still waits for the parent session to become idle, matching the existing runtime.
- DAG state remains in memory only for v1.
- Explicit graph cancellation suppresses future automatic reporting for that graph.

## Workstream 1: Extract Shared Subagent Execution

### Goal

Move the child-session creation and subagent execution logic out of packages/opencode/src/tool/task.ts so a graph node can launch long after the original tool call returned.

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
2. Keep task.ts responsible only for tool schemas, tool metadata, and choosing between blocking and background execution.
3. Keep the existing one-off SessionBackgroundTask.register call in task.ts for the background_task tool.
4. Preserve the current task_id resume behavior and the current background-task output wording.
5. Preserve the current cancellation hook for blocking tasks.

### Acceptance Criteria

- task and background_task behavior is unchanged.
- Existing task tool coverage still passes.
- No DAG logic is added in this step.

## Workstream 2: Add SessionTaskGraph

### Goal

Introduce a dedicated service that owns graph validation, state transitions, readiness checks, node launching, cancellation, and delivery bookkeeping.

### Files

- packages/opencode/src/session/task-graph.ts
  - new graph scheduler service
- packages/opencode/src/effect/app-runtime.ts
  - provide the new layer
- packages/opencode/src/tool/registry.ts
  - add the service dependency because graph tools will need it

### Responsibilities

The graph service should be responsible for:

- registering a whole graph at once
- validating node IDs and dependency edges before any work starts
- tracking pending, running, completed, failed, blocked, and cancelled node states
- launching runnable nodes
- blocking downstream pending nodes when a dependency fails or is cancelled
- tracking which completed nodes still need to be reported to the parent session
- removing finished graphs from memory after all reporting is done

Runtime-only values such as prompt operations, permission callbacks, and delivery callbacks should stay outside the public graph record. They are needed for launching and delivering work, but they should not be part of the graph data returned by list and get operations.

### Registration Algorithm

Graph submission should do the following in order:

1. Reject an empty node list.
2. Validate duplicate node IDs, unknown dependencies, self-dependencies, and cycles.
3. Build the reverse dependency map once during registration.
4. Create all nodes in pending state.
5. Store graph state and runtime context.
6. Trigger scheduling once after registration.
7. Return a summary that includes graph status and node summaries.

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

### Keep Existing One-Off Background Tasks

Do not change background_task, background_task_list, background_task_get, or background_task_cancel semantics in v1.

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

- initialize the new DAG submit and manage tools
- add them to the builtin tool list
- include the graph service in layer requirements

Also update packages/opencode/src/cli/cmd/agent.ts so the tool names can be selected when creating agents.

## Workstream 6: Prompt And UI Integration

### Prompt Guidance

Update packages/opencode/src/session/prompt files to teach models when to prefer:

- background_task for one-off independent work
- background_task_graph for dependent work with explicit prerequisites

The prompt guidance should specifically discourage chaining multiple independent background tasks when the work actually requires ordering.

The prompt guidance should also make the limitation explicit: downstream graph tasks are expected to inspect repository state instead of receiving injected summaries from upstream tasks.

### TUI Integration

Update packages/opencode/src/cli/cmd/tui/routes/session/index.tsx to render the new graph tools with a dedicated summary component or a graph-specific block view that shows:

- graph status
- runnable, running, completed, failed, and blocked counts
- per-node status summaries
- optional child session links when a node has launched

Update packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/subagent.tsx only enough for v1 to avoid misleading labeling. A full sidebar model of DAG node sessions can be deferred if it adds too much complexity.

## Detailed File-Level Change List

### New Files

- packages/opencode/src/session/task-execution.ts
  - reusable service for child subagent execution
- packages/opencode/src/session/task-graph.ts
  - graph scheduler, validation, state transitions, and delivery bookkeeping
- packages/opencode/src/tool/background_task_graph.ts
  - graph submission tool
- packages/opencode/src/tool/background_task_graph_manage.ts
  - list, get, and cancel tools for DAG graphs
- packages/opencode/src/tool/background_task_graph.txt
  - tool description text if the tool descriptions follow the current pattern

### Existing Files To Edit

- packages/opencode/src/tool/task.ts
  - delegate execution to TaskExecution
- packages/opencode/src/tool/registry.ts
  - register graph tools and add service dependency
- packages/opencode/src/effect/app-runtime.ts
  - provide TaskExecution and SessionTaskGraph
- packages/opencode/src/cli/cmd/agent.ts
  - allow DAG tool names in AVAILABLE_TOOLS
- packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
  - render graph tool output
- packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/subagent.tsx
  - avoid incorrect mode labeling for graph-driven subagent sessions
- packages/opencode/src/session/prompt files
  - document when to choose the graph tool

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
  - graph validation and scheduler behavior
- packages/opencode/test/tool/background_task_graph.test.ts
  - submit, list, get, and cancel tool behavior
- packages/opencode/test/tool/task.test.ts
  - confirm the TaskExecution extraction does not change existing tool behavior
- packages/opencode/test/tool/registry.test.ts
  - confirm new tools are registered
- packages/opencode/test/session/prompt.test.ts
  - confirm idle-gated delivery behavior if prompt-level delivery tests are the best fit there

### Minimum Test Cases

- empty graphs are rejected
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
- keep all existing background-task behavior unchanged
- verify current task tests still pass

### Milestone 2

- land SessionTaskGraph
- land background_task_graph
- support validation, runnable-node launch, success, failure, blocking, and per-node delivery

### Milestone 3

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

- one-off background_task behavior is unchanged
- DAG submission validates the whole graph before any node launches
- nodes launch only after all dependencies complete
- downstream nodes rely on repository state instead of injected upstream outputs
- failures and cancellations block downstream pending nodes
- every completed or failed node is eventually reported to the parent session
- parent delivery still respects idle gating
- graph tools are visible in the registry and usable from agents
- package-local tests and typecheck pass

## Recommendation

The simplest viable implementation for OpenCode is a dedicated graph service plus a reusable subagent execution service, with dependencies used only for ordering and with every node reported back to the parent session. That keeps the current fast path intact while adding a DAG path that matches the repo's runtime model without adding a second prompt-level dependency transport system.
