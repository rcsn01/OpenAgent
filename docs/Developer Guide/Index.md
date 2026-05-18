# Developer Guide

How to set up, develop, and contribute to OpenAgent.

## Contents

- [[Developer Guide/Local Development]] — project overview, repository structure, and local dev commands
- [[Developer Guide/Coding Conventions]] — style guide, testing practices, and type-checking rules
- [[Developer Guide/Pull From Upstream]] — compare OpenAgent against the latest upstream opencode release

## Quick Reference

```bash
# Install dependencies
bun install

# Start dev mode
bun dev

# Run tests
bun run --cwd packages/opencode test

# Type check
bun run --cwd packages/opencode typecheck

# App dev server
bun --cwd packages/app dev

# Desktop dev
bun --cwd packages/desktop-electron dev
```

## Repository

- Project home: https://github.com/rcsn01/OpenAgent
- Default branch: `dev`
- Use `dev` or `origin/dev` for diffs (local `main` may not exist)

## Other Topics

For subsystem documentation, see:

- [[Prompt System/Index|Prompt System]] — how system prompts are assembled
- [[Voice Mode/Index|Voice Mode]] — hands-free dictation system
- [[Desktop/Index|Desktop]] — desktop app and `/chat` flow internals
- [[Extensibility/Index|Extensibility]] — adding capabilities without core changes
- [[Architecture/Task Graph]] — DAG background task design
- [[Architecture/OpenSwarm Integration]] — assistant-coordinated specialist routing, OAuth, and artifact tools
