# Goals and Non-Goals

## Design Goals

- Support dependent background subagent work within a single parent session.
- Unify one-off and dependent background work under one runtime.
- Preserve current one-off background_task behavior at the user surface.
- Keep scheduling independent from the main assistant loop.
- Reject malformed graphs before any child session starts.
- Keep the first version simple enough to implement without a second coordination channel between subagents.
- Rely on the shared codebase and files as the handoff surface between ordered tasks.
- Display graph state as a real diagram with positioned nodes and explicit dependency edges.

## Non-Goals

- Maintaining a separate flat background-task runtime beside graphs.
- Passing upstream outputs into downstream prompts through a special dependency injection format.
- Supporting workflows that depend on reasoning that is never written to files or other durable state.
- Introducing a generic workflow engine unrelated to subagent execution.
- Treating a textual node list, adjacency list, or wrapped status table as the primary graph diagram surface.

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
