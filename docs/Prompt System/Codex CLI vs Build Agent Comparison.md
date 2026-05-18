# Codex CLI Prompt Architecture vs OpenAgent `build`

*Comparative analysis, generated after researching the official `openai/codex` Rust CLI codebase.*

---

## At a Glance

| Dimension | Codex CLI | OpenAgent `build` |
|-----------|-----------|-------------------|
| **Primary Role** | Local coding agent in terminal | Coding agent for code generation, editing, refactoring |
| **System Prompt Source** | Resolved priority chain: config → history → default model instructions | Provider prompt only (`build` has no custom agent prompt) |
| **Project Docs** | Hierarchical `AGENTS.md` discovery from CWD to project root | `AGENTS.md` loaded via instruction service |
| **Conversation History** | Full `Vec<ResponseItem>` including tool outputs | Full message history |
| **Tool Outputs** | Post-processed / re-serialized before re-injection | Passed back as-is (no re-serialization layer) |
| **Tool Schemas** | Dynamically assembled per session | Dynamically assembled per session |
| **Real-Time Mode** | Dedicated backend prompt with identity + personalization | Not supported for `build` |
| **Sandbox** | Built-in sandbox (seatbelt/landlock) | Relies on permission system |
| **Subagent Model** | Can spawn subagents with inherited base instructions | Blocking `task` allowed; background/orchestration denied |

---

## Similarities

### 1. No Custom Agent Prompt

Both `build` and Codex CLI rely on the **provider/system prompt** rather than a dedicated agent-specific prompt file.

- **Codex CLI**: The `base_instructions` field is the main system text. It resolves from config, then history, then the default instructions baked into the model metadata (`model_info.get_model_instructions(config.personality)`).
- **OpenAgent `build`**: Explicitly documented as *"does not define a custom agent prompt, so the runtime falls back to the provider prompt."* (`docs/Agents/Primary Agents.md:23`)

### 2. Project Documentation Injection

Both systems actively discover and inject `AGENTS.md` content into the context.

- **Codex CLI**: Walks up the directory tree from CWD to project root (determined by markers like `.git`), concatenates all `AGENTS.md` and `AGENTS.override.md` with `\n\n--- project-doc ---\n\n`.
- **OpenAgent**: Loads `AGENTS.md` via `Instruction.Service`, appending it to the system prompt stack (`docs/Prompt System/Prompt Assembly Flow.md`).

### 3. Full Conversation History with Tool Outputs

Neither system sends just the latest user message. Both maintain the full conversation state.

- **Codex CLI**: The `input` field is a `Vec<ResponseItem>` containing all turns, tool calls, and tool outputs.
- **OpenAgent**: The LLM streaming layer maintains the full message history, including tool results.

### 4. Dynamic Tool Schemas

Both dynamically generate the JSON tool schemas available to the model.

- **Codex CLI**: `create_tools_json_for_responses_api(&prompt.tools)`.
- **OpenAgent**: Tool registry generates schemas based on the active agent's permissions.

---

## Differences

### 1. System Prompt Resolution Depth

**Codex CLI** has a formal, multi-layer resolution strategy for its system prompt (`codex-rs/core/src/session/mod.rs:544-555`):

```
1. User config override (config.base_instructions)
2. Persisted history instructions (resumed threads)
3. Default model instructions (model_info.get_model_instructions(config.personality))
```

**OpenAgent `build`** is simpler. It uses the provider prompt selected for the current model. There is no baked-in history→model fallback chain.

| Layer | Codex CLI | OpenAgent `build` |
|-------|-----------|-------------------|
| Config override | ✅ Explicit priority #1 | ✅ Via `base_instructions` config key |
| Resume from history | ✅ Explicit priority #2 | N/A (no explicit base instruction history) |
| Model default | ✅ Explicit priority #3 | ✅ Provider prompt selected by model |
| Personality injection | ✅ (config.personality) | N/A |

### 2. Tool Output Post-Processing

**Codex CLI** has a dedicated re-serialization layer (`codex-rs/core/src/client_common.rs`, `reserialize_shell_outputs`) that transforms tool outputs before they are re-injected into the conversation history.

For example, when the `apply_patch` tool is present, shell JSON outputs are parsed and re-formatted into human-readable structured text:

```
Exit code: 0
Wall time: 1.23 seconds
Total output lines: 42
Output:
...
```

**OpenAgent `build`** passes tool outputs back into the conversation as they are returned by the tool. There is no re-serialization/normalization step.

> **Relevance for OpenAgent**: This is a potential improvement area. Re-serializing shell and edit tool outputs could reduce token count and improve model comprehension.

### 3. Real-Time / Voice Mode Backend Prompts

**Codex CLI** has a dedicated real-time backend prompt system (`codex-rs/core/src/realtime_prompt.rs`):

- Loads a default template (`templates/realtime/backend_prompt.md`)
- Injects identity: *"You are Codex, an OpenAI general-purpose agentic assistant"*
- Personalizes with the user's local first name (`whoami::realname()`)
- Can be overridden via config or runtime parameter

**OpenAgent `build`** has no real-time or voice mode. The `assistant` agent is the one that handles general-purpose tasks, but even that doesn't have a real-time specific prompt.

### 4. Subagent / Delegation Model

**Codex CLI** allows spawning subagents with inherited `base_instructions` and supports subagent notifications injected into the parent conversation (`session_prefix.rs`, `format_subagent_notification_message`).

**OpenAgent `build`** can use blocking `task` to spawn subagents, but:
- Cannot spawn OpenSwarm feature specialists (`deep-research`, `data-analyst`, etc.)
- Cannot use background tasks, graph tasks, or `send_message`
- Background / orchestration tools are `assistant`-only

The architectural intent differs:
- Codex CLI: Subagents inherit session context and report back via structured notifications.
- OpenAgent `build`: Blocking `task` is for synchronous work delegation, not asynchronous orchestration.

### 5. Sandbox vs. Permission System

**Codex CLI** has a built-in sandbox (Seatbelt on macOS, Landlock on Linux) that restricts file system access before the agent ever acts.

**OpenAgent `build`** relies on the **Permission System** (`docs/Agents/Permission System.md`) to gate tool access. The agent can attempt any action allowed by its tool registry exposure, and permissions provide hard constraints at the tool-call level.

> **Relevance**: Codex's sandbox is a safety layer *outside* the prompt; OpenAgent's permissions are also a safety layer but they operate within the tool registry rather than the OS process.

---

## Key Takeaways for OpenAgent

### What `build` Already Does Well

- `build` already uses the same "provider prompt + project docs + history" layering model as Codex CLI.
- The instruction loading system (`AGENTS.md`) is functionally equivalent to Codex's hierarchical discovery.
- Dynamic tool schema generation is already in place.

### What Could Be Adopted from Codex CLI

1. **Tool Output Re-serialization**: Codex CLI normalizes shell and patch tool outputs before re-injecting them. This reduces noise and token count. OpenAgent could benefit from a similar normalization layer.

2. **Base Instruction Priority Chain**: Codex CLI's explicit resolution order (config → history → model default) is more robust than OpenAgent's current approach. If OpenAgent adds instruction persistence or per-model defaults, formalizing this chain would help.

3. **Real-Time Backend Prompts**: If OpenAgent eventually adds voice or real-time coding mode, Codex CLI's template-based backend prompt system with identity and personalization is a good reference.

4. **Subagent Context Inheritance**: Codex CLI's `format_subagent_notification_message` ensures subagent status is visible in the parent conversation. OpenAgent's `task` tool could benefit from injecting child agent status into the parent context.

### What Should Not Be Changed

- `build` should remain focused on coding. The lack of background tasks / `send_message` is intentional; delegation belongs to `assistant`.
- `build` already correctly lacks a custom agent prompt, keeping the prompt stack simple for its purpose.

---

## References

### Codex CLI
- `codex-rs/core/src/session/mod.rs:544-555` — Base instruction resolution.
- `codex-rs/core/src/client.rs:746-765` — API request payload construction.
- `codex-rs/core/src/client_common.rs` — Prompt struct, tool output re-serialization.
- `codex-rs/core/src/agents_md.rs` — AGENTS.md discovery.
- `codex-rs/core/src/realtime_prompt.rs` — Real-time backend prompt.

### OpenAgent
- `docs/Agents/Primary Agents.md` — Build agent definition and capabilities.
- `docs/Prompt System/Prompt Assembly Flow.md` — System prompt stacking order.
- `docs/Prompt System/Overview.md` — Layered prompt mental model.
- `docs/Architecture/OpenSwarm Integration.md` — Subagent routing and communication.