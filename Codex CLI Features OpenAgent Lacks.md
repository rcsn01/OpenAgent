# Codex CLI Features OpenAgent Doesn't Have

A comprehensive inventory of features in the official Codex CLI (`openai/codex`) that are absent from OpenAgent.

---

## Architecture / Infrastructure

| Feature | What It Does |
|---------|-------------|
| **OS-Level Sandbox** | Seatbelt (macOS), Landlock (Linux), Windows Sandbox — restricts file system and network access at the operating-system level before the agent acts |
| **Context Compaction** | Automatic and manual summarization of conversation history to prevent hitting the model's context window. Supports remote compaction via API |
| **Mid-Turn Compaction** | Compacts history *during* an active turn, injecting the summary before the last user message so the model can continue seamlessly |
| **Hook Runtime** | Pre/post hooks around tool use, compaction, and pending input. Plugins can intercept and modify tool calls before execution |
| **Unified Exec** | Unified command execution handler that abstracts over different sandbox policies (seatbelt vs landlock vs none) |
| **Shell Snapshot Inheritance** | Spawned subprocesses inherit the parent's shell environment snapshots (cwd, env vars, shell state) |
| **Process Stdin Injection** | `write_stdin` tool — write to the stdin of a long-running child process |

---

## Goal / Task Management

| Feature | What It Does |
|---------|-------------|
| **Thread-Scoped Goal Runtime** | Persisted objectives with token/wall-clock budget tracking and auto-continuation prompts when a turn ends but the goal is still active |
| **Test Sync Tool** | Multi-agent barrier for coordinating test execution across spawned agents — waits for all agents to reach a checkpoint before continuing |
| **Request Permissions Tool** | Model can request runtime permission profile changes (e.g., "give me write access to this directory") |

---

## Collaboration & Multi-Agent

| Feature | What It Does |
|---------|-------------|
| **Multi-Agent V2** | Advanced multi-agent coordination with bidirectional communication and task graphs |
| **Spawn Agent from CSV** | Batch spawn agents from a CSV file for parallel work |
| **Collaboration Modes** | Pair programming mode and other pre-defined collaboration templates |
| **Send Input to Agent** | Send follow-up messages to already-running child agents without blocking |
| **Wait Agent** | Wait for a child agent to finish with configurable timeout |
| **Close Agent** | Force-terminate a child agent |
| **Resume Agent** | Resume a paused child agent session |

---

## Research & Discovery

| Feature | What It Does |
|---------|-------------|
| **Tool Search** | Model can search available tools by description — useful when there are hundreds of MCP tools |
| **In-App Browser** | Model can open a real browser and interact with web pages |
| **Browser Use** | Browser automation for research tasks |
| **Web Search** | Built-in web search tool |
| **Web Search Caching** | Cache web search results |
| **View Image** | Model can request to view image files (not just receive them as attachments) |
| **Image Generation** | Built-in image generation tool |

---

## Communication & Persona

| Feature | What It Does |
|---------|-------------|
| **Personality System** | Configurable communication styles (friendly, pragmatic, etc.) baked into the system prompt |
| **Real-Time / Voice Mode** | WebRTC-based real-time voice conversation with a dedicated backend prompt |
| **In-App Browser for Auth** | OAuth flows can open a browser for authentication |
| **Speech-to-Text / Text-to-Speech** | For the voice mode |

---

## Safety & Review

| Feature | What It Does |
|---------|-------------|
| **Guardian Review** | Automated security review of changes before they are applied. Can block suspicious edits |
| **Auto-Review** | Configurable automatic review policy that runs on every change |
| **Approval Policies** | Rich approval system with "always", "ask", "deny" per tool and per pattern |
| **Permission Profiles** | Named permission profiles that can be switched at runtime |
| **Exec Permission Approvals** | Separate approval layer specifically for shell command execution |
| **Network Approval** | Model must request permission for network access when sandbox blocks it |
| **Windows Sandbox Elevated** | Request elevated sandbox permissions on Windows |

---

## Memory & Persistence

| Feature | What It Does |
|---------|-------------|
| **Memory Consolidation (Chronicle)** | Automatic memory extraction and persistence across sessions. A background agent summarizes and writes memories to disk |
| **Thread Store with State DB** | SQLite-based thread store with full persistence, resumption, compaction history, and goal tracking |
| **Session Rollout Files** | Every session writes a rollout trace to disk for debugging and replay |
| **Memories Directory** | `~/.codex/memories` — repository of learned patterns and conventions |

---

## MCP & Extensions

| Feature | What It Does |
|---------|-------------|
| **MCP Resource Templates** | List and read MCP resource templates |
| **MCP Resource Discovery** | Dynamic discovery of MCP resources from connected servers |
| **Dynamic Tools** | Runtime-discoverable tools that are loaded lazily |
| **Extension Tools** | User-defined tools via extension system |
| **Plugin Hooks** | Lifecycle hooks for custom plugins (pre/post tool, compaction, etc.) |
| **Skills System** | Loadable skills with their own prompts, tools, and configuration |
| **Apps Integration** | Third-party app integration framework |

---

## Tool Execution Modes

| Feature | What It Does |
|---------|-------------|
| **Code Mode** | Separate execution mode with its own tools and prompt. Used for structured code generation |
| **Freeform Apply Patch** | `apply_patch` as a freeform tool instead of a function tool — produces structured text output, not JSON |
| **Apply Patch Streaming** | Streaming events for apply patch progress |

---

## Telemetry & Observability

| Feature | What It Does |
|---------|-------------|
| **Runtime Metrics** | Detailed per-turn metrics: token usage, wall-clock time, tool call latency, etc. |
| **OpenTelemetry Integration** | Full OTLP export of spans, metrics, and logs |
| **Rollout Trace** | Every session produces a trace file for debugging |
| **Attestation Headers** | Cryptographic attestation on API requests for audit trails |

---

## What OpenAgent Already Has Equivalents For

| Codex Feature | OpenAgent Equivalent |
|---------------|----------------------|
| `AGENTS.md` | `AGENTS.md` (but Codex walks the full tree, OpenAgent stops at first match) |
| `todowrite` / `update_plan` | `todowrite` (but Codex bakes the reminder into the system prompt) |
| `apply_patch` | `apply_patch` |
| `shell` | `shell` |
| `read` / `glob` / `grep` | `read` / `glob` / `grep` |
| `question` | `question` |
| `task` / `background_task` | `task` / `background_task` / `background_task_graph` |
| `send_message` | `send_message` |
| `MCP` | `MCP` |
| `LSP` | `LSP` |
| `Plan Mode` | `plan` agent |
| `compact` | Compaction (but Codex has mid-turn compaction) |
| **Plugin system** | **Plugin system** (but Codex has pre/post hooks, OpenAgent has system transform hooks) |
| **Permission system** | **Permission system** (but Codex has richer profiles + runtime permission requests) |
| **Subagents** | **Subagents** / specialists |
| **Git commands** | **Git tool** |

---

## Summary

Codex CLI is a significantly more mature and feature-rich product. It has deep OS integration (sandbox), advanced memory systems (chronicle), multiple execution modes (code mode), real-time voice, browser automation, automated safety review (guardian), and sophisticated telemetry. OpenAgent's architecture is more modular and extensible (multi-provider support, skill system, plugin hooks), but it lacks the depth of OS-layer safety, memory persistence, and runtime goal management that Codex provides.

The most impactful gaps for OpenAgent to close are:
1. **OS-level sandbox** — Seatbelt/Landlock-style process isolation
2. **Goal runtime** — Thread-scoped objectives with auto-continuation
3. **Memory consolidation** — Cross-session learning and context persistence
4. **Context compaction** — Mid-turn compaction to prevent context overflow
5. **Personality system** — Configurable communication styles
6. **Browser / web search** — Research capabilities
7. **Guardian review** — Automated safety layer before destructive operations
