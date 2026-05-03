# State and Invariants

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
