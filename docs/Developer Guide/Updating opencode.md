# Updating opencode

OpenAgent no longer merges from an external opencode Git remote.

To update the runtime contract:

1. Bump `@opencode-ai/sdk` in the retained package manifests.
2. Run `bun install`.
3. Run package typechecks and app unit tests.
4. Verify web and desktop against an installed external `opencode` CLI/server at the matching version.

Runtime behavior is owned by opencode. OpenAgent changes should stay inside the GUI, desktop shell, shared UI, and slim GUI utilities.
