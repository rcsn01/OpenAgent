# OpenAgent Knowledge Base

Obsidian-style knowledge base for understanding how OpenAgent is put together.

## Project Scope

This project is based off of [opencode](https://github.com/sst/opencode). All native opencode functionality is preserved as-is.

New work is limited to two surfaces:

- **GUI side** — the Electron desktop app and the shared web UI
- **Assistant Agent** — the `assistant` primary agent

The `assistant` agent is the general-purpose coordinator — it handles research, delegation, specialist routing, background tasks, and all new capabilities. The `build` agent is kept strictly as the coding agent. This separation ensures coding workflows stay lean and predictable while new features grow through assistant.

Additional functionalities must be **assistant-only** and never exposed to `build`, `plan`, `general`, `explore`, or any OpenSwarm specialist subagent. This is enforced through the permission system and tool registry gating.

The goal is to keep opencode as native as possible while layering new capabilities into the assistant agent.

See [[Project Scope]] for more.

## Topics

### Agents

Agent definitions, capabilities, tool access rules, and permissions.

- [[Agents/Index|Agents]] — overview of all 14 native agents
- [[Agents/Primary Agents]] — `build`, `assistant`, and `plan`
- [[Agents/OpenSwarm Specialists]] — the 6 specialist subagents plus `general` and `explore`
- [[Agents/Permission System]] — hard enforcement of tool access per agent

### Prompt System

How the system prompt is assembled layer by layer.

- [[Prompt System/Index|Prompt System]] — overview and navigation
- [[Prompt System/Overview]] — the mental model and why the stack matters
- [[Prompt System/Provider Prompts]] — provider prompt selection and file catalog
- [[Prompt System/Agent Prompts]] — built-in agents, custom agents, config-driven agents
- [[Prompt System/Instructions]] — AGENTS.md, remote instructions, dynamic file-walk rules
- [[Prompt System/Skills]] — skill discovery, loading, and the `skill` tool
- [[Prompt System/Prompt Assembly Flow]] — the exact order things are joined at runtime

### Desktop

How the Electron desktop app works, including GUI chat.

- [[Desktop/Index|Desktop]] — overview and navigation
- [[Desktop/Hidden Workspaces]] — hidden directory structure and per-chat workspaces
- [[Desktop/Shared Chat Profile]] — the shared config bundle for all GUI chats
- [[Desktop/Session Switching]] — persistent UI shell, route unification, sidebar and audio fixes
- [[Desktop/Subagent Graph Panel and Prompt Updates]] — graph groups, retention, ordering, web tool guidance
- [[Desktop/Project Sidebar Controls]] — project header toolbar and menus

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
- [[Voice Mode/Implementation History]] — the 6 phases of development
- [[Voice Mode/Testing]] — test coverage and what each suite verifies

### Extensibility

How to add new capabilities, tools, plugins, and chat-specific behaviors.

- [[Extensibility/Index|Extensibility]] — overview and navigation
- [[Extensibility/Implementing Features]] — choose between instructions, skills, tools, and plugins
- [[Extensibility/Plugin Development]] — create a plugin and get chat to use it reliably
- [[Extensibility/Project-Scoped Extensions]] — ship official app-bundled extensions

### Architecture

System design documents.

- [[Architecture/OpenSwarm Integration]] — native specialist routing, assistant-only swarm tools, per-user OAuth
- [[Architecture/Task Graph]] — DAG-based background task graph design

### Developer Guide

Local development setup and coding conventions.

- [[Developer Guide/Index|Developer Guide]] — overview and navigation
- [[Developer Guide/Local Development]] — project overview and local dev commands
- [[Developer Guide/Coding Conventions]] — style guide, testing, and type-checking
- [[Developer Guide/Pull From Upstream]] — inspect what upstream opencode added since the last shared commit
