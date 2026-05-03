# OpenAgent Knowledge Base

This folder is a starting Obsidian-style knowledge base for understanding how OpenAgent is put together.

## Topics

### Prompt System

How the system prompt is assembled layer by layer.

- [[Prompt System/Index|Prompt System]] — overview and navigation
- [[Prompt System/Overview]] — the mental model and why the stack matters
- [[Prompt System/Base Prompt]] — provider prompts (GPT, Claude, Gemini, Kimi, etc.)
- [[Prompt System/Agent Prompts]] — built-in agents, custom agents, config-driven agents
- [[Prompt System/Primary Agents]] — the 4 main user-facing agents: `build`, `assistant`, `chat`, and `plan`
- [[Prompt System/Instructions]] — AGENTS.md, remote instructions, dynamic file-walk rules
- [[Prompt System/Skills]] — skill discovery, loading, and the `skill` tool
- [[Prompt System/Permission System]] — how permissions constrain behaviour outside prompts
- [[Prompt System/Prompt Assembly Flow]] — the exact order things are joined in `llm.ts` and `prompt.ts`
- [[Prompt System/Provider Prompt Catalog]] — what each provider-specific prompt targets

### Voice Mode

The hands-free dictation system.

- [[Voice Mode/Index|Voice Mode]] — overview and navigation
- [[Voice Mode/Architecture]] — the renderer + main process pipeline
- [[Voice Mode/Activation]] — always-on vs press-to-talk
- [[Voice Mode/Voice Activity Detection]] — RMS-based adaptive detection
- [[Voice Mode/Chunking]] — pre-roll, active buffers, and turn merger
- [[Voice Mode/Endpointing]] — when to auto-submit based on speech patterns
- [[Voice Mode/Transcription]] — Parakeet (ONNX) and Apple Speech (macOS)
- [[Voice Mode/Native Capture]] — macOS AVAudioEngine bypassing browser audio
- [[Voice Mode/Post-Processing]] — dictionary, corrections, and prompt application
- [[Voice Mode/Settings]] — all user-configurable options
- [[Voice Mode/Implementation History]] — the 5 phases of development
- [[Voice Mode/Testing]] — test coverage and what each suite verifies

### GUI Chat Mode

How the standalone `/chat` experience works in the GUI app.

- [[GUI Chat Mode/Index|GUI Chat Mode]] — overview and navigation
- [[GUI Chat Mode/Hidden Workspaces]] — hidden directory structure, location, and whether chat-only `AGENTS.md` / skills are possible
- [[GUI Chat Mode/Shared Chat Profile]] — the shared config bundle that applies across all GUI chats

### Extensibility

How to add new capabilities, tools, plugins, and chat-specific behaviors with less friction.

- [[Extensibility/Index|Extensibility]] — overview and navigation
- [[Extensibility/Implementing Features]] — choose between instructions, skills, tools, and plugins
- [[Extensibility/Plugin Development]] — create a plugin and get chat to use it reliably
