# Current System Baseline

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
