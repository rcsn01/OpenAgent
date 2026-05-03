# Background Task Graph Design

## Summary

OpenCode already supports background subagent execution, but the current runtime only tracks a flat set of independently launched tasks. The next version should move all background subagent work onto one graph runtime instead of keeping a flat background-task system beside a DAG system.

The simplified design is:

- Represent every background submission as a graph.
- Keep the `background_task` tool for independent work, but implement it as a single-node graph with no dependencies.
- Use `background_task_graph` only when the caller needs to submit multiple nodes or explicit dependency edges.
- Treat dependencies as ordering only, not as a mechanism for passing outputs between subagents.
- Treat graph display as a first-class requirement: the UI should render an actual node-and-edge diagram, not only textual summaries.
- Let downstream subagents work from the shared codebase and files, not injected upstream results.
- Report every completed graph node back to the main agent, using the existing parent-idle delivery behavior.
- Keep DAG state in memory for v1.

This simplification is reasonable if graph nodes coordinate through repository state, edited files, and other durable side effects. If a workflow depends on unstored reasoning that exists only in a subagent response and is not written anywhere the next subagent can inspect, that workflow is out of scope for this first version.

## Contents

- [[Background Task Graph Design]] — this document: summary and navigation
- [[Background Task Graph/Goals and Non-Goals]] — design goals, non-goals, and simplified DAG model
- [[Background Task Graph/Current System Baseline]] — existing flat background-task runtime
- [[Background Task Graph/Child Sessions]] — how child sessions work in this system
- [[Background Task Graph/Implementation Plan]] — six workstreams and detailed steps
- [[Background Task Graph/Delivery and UI]] — parent delivery, prompt guidance, and diagram UI
- [[Background Task Graph/State and Invariants]] — state transitions, validation rules, invariants
- [[Background Task Graph/Testing and Rollout]] — test plan, milestones, acceptance checklist

