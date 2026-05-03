# Delivery and UI

## Parent Delivery

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

## Prompt Guidance

Update packages/opencode/src/session/prompt files to teach models when to prefer:

- background_task for one-off independent work that should launch immediately as a single-node graph
- background_task_graph for dependent work with explicit prerequisites

The prompt guidance should specifically discourage chaining multiple independent background tasks when the work actually requires ordering, because the scheduler cannot enforce dependencies unless the work is submitted as one graph.

The prompt guidance should also make the limitation explicit: downstream graph tasks are expected to inspect repository state instead of receiving injected summaries from upstream tasks.

## Diagram UI Integration

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
