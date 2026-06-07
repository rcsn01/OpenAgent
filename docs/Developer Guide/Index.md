# Developer Guide

OpenAgent is a GUI workspace for external opencode servers.

## Contents

- [[Developer Guide/Local Development]] — repository structure and local dev commands
- [[Developer Guide/Coding Conventions]] — style guide, testing practices, and type-checking rules
- [[Developer Guide/Updating opencode]] — update the external SDK/server contract

## Quick Reference

```bash
bun install
bun run --cwd packages/core typecheck
bun run --cwd packages/ui typecheck
bun run --cwd packages/app typecheck
bun run --cwd packages/desktop typecheck
bun run --cwd packages/app test:unit
```

## Repository

- Project home: https://github.com/rcsn01/OpenAgent
- Runtime contract: external `opencode` server plus pinned `@opencode-ai/sdk`
