# Codex CLI Prompt Architecture

*Analysis of the official OpenAI Codex CLI repository (`openai/codex`), May 2026.*

## Summary

When a user sends a prompt to Codex CLI, the raw user text is **not** passed straight to the AI. Instead, the client constructs a comprehensive `Prompt` object that layers system instructions, project documentation, conversation history, tool schemas, and metadata before calling the OpenAI Responses API via WebSocket or HTTP.

---

## What Gets Added to Your Prompt

### 1. System / Base Instructions

Every request includes a mandatory `instructions` field that acts as the system prompt.

**Resolution order** (from `codex-rs/core/src/session/mod.rs:544-555`):

1. **`config.base_instructions`** — user override in config.
2. **Persisted instructions** from resumed conversation history.
3. **Default model-specific instructions** (`model_info.get_model_instructions(config.personality)`).

This text is attached to the API request at `codex-rs/core/src/client.rs:718`:

```rust
let instructions = &prompt.base_instructions.text;
```

### 2. Project-Level Context (`AGENTS.md`)

Codex actively discovers and injects project documentation.

**Discovery logic** (`codex-rs/core/src/agents_md.rs`):

- Walks up the directory tree from the current working directory to the project root (determined by markers like `.git`).
- Collects every `AGENTS.md` and `AGENTS.override.md` found along the path.
- Concatenates them with the separator `\n\n--- project-doc ---\n\n`.

This content is merged into `session_configuration.user_instructions` and ultimately included in the conversation context.

### 3. Conversation History & Tool Outputs

The `input` array in the API request is a `Vec<ResponseItem>` representing the full conversation state, not just the latest user message.

It contains:

- All previous user turns.
- All model responses.
- **Tool call outputs** (e.g., results from `shell`, `apply_patch`, MCP servers).

**Output post-processing** (`codex-rs/core/src/client_common.rs`, `reserialize_shell_outputs`):

When the `apply_patch` tool is present, shell outputs are re-serialized from raw JSON into a structured human-readable format before being added to history.

### 4. Tool Specifications

The prompt includes a JSON schema for every tool available to the model so it knows what actions it can take.

```rust
let tools = create_tools_json_for_responses_api(&prompt.tools)?;
```

These schemas are generated dynamically based on the session's enabled skills, plugins, and MCP servers.

### 5. Real-Time Backend Prompts (Real-Time Mode)

If using the real-time feature, a default backend prompt template is injected (`codex-rs/core/src/realtime_prompt.rs`):

- Identity: *"You are Codex, an OpenAI general-purpose agentic assistant..."*
- Personalized with the user's local first name (`whoami::realname()`).
- Can be overridden via `config_prompt` or the runtime `prompt` parameter.

---

## The Request Payload

When the request is finally sent to the OpenAI Responses API (`codex-rs/core/src/client.rs:746-765`), it looks like this:

```rust
ResponsesApiRequest {
    model: model_info.slug.clone(),
    instructions: instructions.clone(),      // system/base prompt
    input,                                   // full conversation history
    tools,                                   // tool JSON schemas
    tool_choice: "auto".to_string(),
    parallel_tool_calls: prompt.parallel_tool_calls,
    reasoning,                               // reasoning effort settings
    stream: true,
    include: vec!["reasoning.encrypted_content".to_string()],
    service_tier,
    prompt_cache_key: Some(self.state.thread_id.to_string()),
    text,                                    // verbosity / output schema
    client_metadata: Some(HashMap::from([...])),
}
```

---

## Key Takeaways for OpenAgent

| Aspect | Codex CLI Behavior | OpenAgent Relevance |
|--------|-------------------|---------------------|
| **System prompt** | Resolved from config → history → model default | Similar layering already exists in `Prompt Assembly Flow.md` |
| **Project docs** | Automatic `AGENTS.md` discovery with hierarchical walking | OpenAgent already supports `AGENTS.md` loading; this confirms the approach |
| **Tool outputs** | Post-processed before re-injecting into history | OpenAgent should consider normalizing tool output before adding to context |
| **Conversation history** | Full `ResponseItem` array, not just latest message | Matches OpenAgent's session state model |
| **Real-time mode** | Dedicated backend prompt with identity and personalization | Relevant if OpenAgent adds real-time / voice mode |

## References

- `codex-rs/core/src/session/mod.rs` — Session initialization, base instruction resolution.
- `codex-rs/core/src/client.rs` — `build_responses_request`, API payload construction.
- `codex-rs/core/src/client_common.rs` — `Prompt` struct, shell output re-serialization.
- `codex-rs/core/src/agents_md.rs` — `AGENTS.md` discovery logic.
- `codex-rs/core/src/realtime_prompt.rs` — Real-time backend prompt templates.
