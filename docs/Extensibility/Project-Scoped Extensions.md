# Project-Scoped Extensions

This note is the practical reference for adding another official project-scoped extension.

Project-scoped extensions are managed bundles of:

- MCP server config
- managed skills
- app-side marketplace metadata
- project-local install state

They are separate from the existing plugin system. Plugins remain global/workspace capability bundles. Extensions are installed into the current project and are surfaced in the session right-side Extensions panel.

## Mental Model

An extension is an app-bundled registry entry that the GUI sends to the server as a full install payload.

The server does not maintain its own marketplace catalog. It only validates and installs the bundle it receives.

Install writes project-local state:

- MCP entries go into `config.mcp`
- extension metadata goes into `config.extensions.installed`
- managed skills are copied under `.opencode/skills/extensions/<extension-id>/`

At runtime, managed extension skills are normal skills. MCP tools are normal MCP tools, namespaced by MCP server key.

## Key Files

| File | Role |
|------|------|
| `packages/app/src/extensions/registry.ts` | Official app-bundled extension registry |
| `packages/app/src/extensions/registry.test.ts` | Registry shape and install-action tests |
| `packages/app/src/pages/session/session-extensions-panel.tsx` | Session right-side Extensions panel |
| `packages/app/src/pages/session/session-extensions-panel-model.ts` | Merges registry, installed state, and live MCP state |
| `packages/app/src/pages/session/session-extensions-install.ts` | Install follow-up orchestration: install, auth/connect, refresh |
| `packages/opencode/src/extension/index.ts` | Server-side install/remove/list/live-reload module |
| `packages/opencode/src/config/extension.ts` | `Config.Info.extensions` schema |
| `packages/opencode/src/mcp/index.ts` | MCP runtime, local HTTP spawning, OAuth handling, status/tools |
| `packages/opencode/src/mcp/auth.ts` | Stored MCP OAuth credentials and local signing key metadata |
| `packages/opencode/src/mcp/oauth-callback.ts` | Local OAuth callback server and pending state tracking |
| `packages/opencode/test/server/httpapi-experimental.test.ts` | Extension route and install regression tests |
| `packages/opencode/test/mcp/oauth-browser.test.ts` | Browser/OAuth runtime tests |
| `packages/opencode/test/mcp/lifecycle.test.ts` | MCP lifecycle and cleanup tests |

## Bundle Shape

The server-side install payload is defined by `ExtensionBundle` in `packages/opencode/src/extension/index.ts`.

The app registry entry extends that bundle with UI metadata:

```ts
type ExtensionRegistryEntry = ExtensionBundle & {
  tags?: string[]
  setup?: {
    prerequisites?: string[]
    environment?: string[]
    steps?: string[]
    links?: Array<{ label: string; href: string }>
  }
}
```

An extension should include:

- stable `id`
- bumped `version` when config or skill behavior changes
- human-readable `name` and `description`
- one or more MCP server configs keyed by stable names
- skills as `{ path, content }` pairs
- setup metadata if users need local tools, env vars, or upstream docs

## Managed Config Rules

Managed MCP keys must be deterministic and stable. Tool IDs are derived from server key plus tool name, so renaming a key is a breaking change.

For example, the Google Calendar extension uses:

```text
google_workspace_calendar
```

Removal is safe because extension metadata records exactly which MCP server keys and skill roots are owned by the extension.

Install and reinstall should be idempotent:

- replacing owned MCP entries
- replacing the managed skill subtree
- updating metadata
- leaving non-owned config untouched

## Skills

Managed skills are copied into:

```text
.opencode/skills/extensions/<extension-id>/...
```

Skill frontmatter names should be globally unique. For official bundles, use:

```text
<extension-id>:<skill-name>
```

Example:

```yaml
---
name: google-calendar:daily-brief
description: Prepare a daily schedule summary from calendar events, open tasks, and available focus time.
---
```

Skills should reference the stable MCP server key and the expected tools. They should not assume unrelated MCP servers exist.

## App Install Flow

Install orchestration lives in the app, not the server.

The app flow is:

1. User clicks Install
2. App sends the full bundle to `experimental.extensions.install`
3. App classifies each bundled MCP server action
4. App calls `mcp.auth.authenticate({ name })` for OAuth-capable servers
5. App calls `mcp.connect({ name })` for non-OAuth servers
6. App refreshes extension/MCP state

The testable helper is:

```text
packages/app/src/pages/session/session-extensions-install.ts
```

The registry action classifier should return `authenticate` for:

- remote MCPs unless `oauth === false`
- local `streamable-http` MCPs with `oauth`

It should return `connect` for local stdio MCPs and non-OAuth local HTTP MCPs.

## Panel Model Rules

The Extensions panel merges:

- app-bundled registry entries
- installed extension state from `GET /experimental/extensions`
- live MCP status from sync data

For installed OAuth-capable servers, `disabled` can still mean "installed but not currently running." The panel should render `Authenticate`, not plain `Connect`, when an installed local HTTP OAuth server is disabled.

This avoids the bad flow where users see "Connect", connect fails or silently does not open OAuth, and agents later report the extension as disabled.

## Local HTTP OAuth MCPs

Some MCP servers need to be launched locally but accessed over HTTP so OAuth 2.1 works correctly.

Use `ConfigMCP.Local.transport`:

```json
{
  "type": "local",
  "enabled": true,
  "command": ["uvx", "workspace-mcp", "--transport", "streamable-http"],
  "transport": {
    "type": "streamable-http",
    "host": "localhost",
    "path": "/mcp",
    "portEnv": "WORKSPACE_MCP_PORT"
  },
  "oauth": {}
}
```

Runtime responsibilities:

- allocate an ephemeral loopback port
- inject it into the child environment through `portEnv`
- connect with `StreamableHTTPClientTransport`
- use the existing MCP OAuth provider and callback flow
- kill the spawned child on disconnect, reconnect, failed startup, and instance disposal

## OAuth Pitfalls We Hit

Local HTTP OAuth had several sharp edges.

First, credentials must include both Google OAuth client ID and client secret for the Google Workspace MCP. A client ID alone can open the browser but fail token exchange with:

```text
client_secret is missing
```

Second, stale dynamic client registration must be cleared before a new local OAuth auth flow. The child MCP process owns dynamic registrations, so registrations stored from a previous child process are stale.

Third, FastMCP's local token signing key must be stable across child restarts. If a random signing key is injected on every spawn, tokens saved during auth become invalid when the server restarts.

Store a stable per-MCP signing key in `mcp-auth.json` through `McpAuth.getOrCreateLocalAuthSigningKey`.

Fourth, OAuth callbacks need a realistic human timeout. Five minutes is too short for Google account selection, unverified-app warnings, permissions, and distractions. The callback timeout is now 30 minutes.

Fifth, after `finishAuth`, local HTTP OAuth must reconnect against the same loopback URL and port that issued the token. Starting a new local MCP on a new random port can make the freshly issued token fail immediately as `invalid_token`.

Sixth, a successful auth/connect should not leave project config saying `enabled: false`. Otherwise a later session or agent can correctly read config and incorrectly conclude the extension is installed but disabled.

## Google Calendar Extension Example

The Google Calendar extension is the first official extension.

Registry basics:

```ts
{
  id: "google-calendar",
  version: "2.0.1",
  name: "Google Calendar",
  description: "Google Calendar and Google Tasks for planning, scheduling, and meeting workflows.",
  tags: ["google", "calendar", "tasks", "scheduling", "productivity"]
}
```

It uses one MCP server:

```text
google_workspace_calendar
```

Backend:

```text
taylorwilsdon/google_workspace_mcp
```

Command:

```text
uvx workspace-mcp --transport streamable-http --permissions calendar:full tasks:full --tool-tier extended
```

Important environment:

```json
{
  "GOOGLE_OAUTH_CLIENT_ID": "{env:GOOGLE_OAUTH_CLIENT_ID}",
  "GOOGLE_OAUTH_CLIENT_SECRET": "{env:GOOGLE_OAUTH_CLIENT_SECRET}",
  "MCP_ENABLE_OAUTH21": "true",
  "WORKSPACE_MCP_HOST": "localhost",
  "OAUTHLIB_INSECURE_TRANSPORT": "1"
}
```

Important runtime behavior:

- install triggers `mcp.auth.authenticate`
- browser opens to local FastMCP consent
- then Google account/consent screens
- after callback, runtime reconnects on the same local HTTP port
- extension panel should show `connected`
- tool list should include `query_freebusy`, `list_tasks`, and `manage_task`

Skills:

- `google-calendar:general`
- `google-calendar:daily-brief`
- `google-calendar:free-up-time`
- `google-calendar:group-scheduler`
- `google-calendar:meeting-prep`

## Google OAuth Credential Setup

For local Google Workspace OAuth, the registry and project config should only contain env placeholders. Do not commit real Google secrets.

The setup that worked for the Google Calendar extension:

1. Create or select a Google Cloud project
2. Enable the Google Calendar API
3. Enable the Google Tasks API
4. Configure the OAuth consent screen
5. Add the account that will authenticate as a test user when the app is in testing mode
6. Create an OAuth client ID for a local app flow
7. Download the client secret JSON
8. Read `client_id` and `client_secret` from that JSON
9. Put those values in the app process environment
10. Restart the desktop app or dev server so the MCP child process inherits them

For a macOS app launched from the desktop, `launchctl` is the useful place to set env vars:

```sh
launchctl setenv GOOGLE_OAUTH_CLIENT_ID "..."
launchctl setenv GOOGLE_OAUTH_CLIENT_SECRET "..."
```

Check them with:

```sh
launchctl getenv GOOGLE_OAUTH_CLIENT_ID
launchctl getenv GOOGLE_OAUTH_CLIENT_SECRET
```

For shell-launched development, regular shell env vars are enough:

```sh
export GOOGLE_OAUTH_CLIENT_ID="..."
export GOOGLE_OAUTH_CLIENT_SECRET="..."
```

If auth opens the browser but token exchange fails, check the client secret first. A client ID alone is not enough for the Google Workspace MCP flow we used.

If an old project already installed the extension before the registry was fixed, reinstall the extension or patch the managed MCP entry so it has:

- `enabled: true`
- `GOOGLE_OAUTH_CLIENT_ID: "{env:GOOGLE_OAUTH_CLIENT_ID}"`
- `GOOGLE_OAUTH_CLIENT_SECRET: "{env:GOOGLE_OAUTH_CLIENT_SECRET}"`

## TDD Checklist For A New Extension

Start with tests before registry changes when behavior is subtle.

App tests:

- registry entry is well formed
- install action classifies OAuth servers as `authenticate`
- install helper calls install, then authenticate/connect, then refresh
- panel model merges installed state and registry setup metadata
- disabled installed OAuth servers render Authenticate

Server/extension tests:

- install writes owned MCP entries
- reinstall replaces owned MCP entries and skill subtree
- remove deletes only owned MCP entries, skill roots, and metadata
- malformed bundles fail validation
- reinstall upgrades persisted config to the new shape

MCP runtime tests:

- local HTTP OAuth is auth-capable
- browser open is attempted for auth
- browser-open failure emits fallback event
- spawned child gets loopback port env
- spawned child is killed on cleanup
- local OAuth signing key is stable
- post-auth reconnect uses the same loopback URL
- OAuth callback state timeout is long enough for real consent flows

## Manual Verification Checklist

After implementation:

1. Install the extension into a project
2. Confirm project `opencode.json` has the managed MCP entry
3. Confirm managed skills exist under `.opencode/skills/extensions/<extension-id>/`
4. Confirm install opens the native browser if OAuth-capable
5. Complete OAuth
6. Confirm Extensions panel shows the server as `connected`
7. Confirm expected tools are listed
8. Ask an agent to use a tool from the extension
9. Restart the app/session and confirm it does not report the extension as disabled

For Google Calendar specifically, confirm:

- `enabled` is `true`
- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set in the launch environment
- `query_freebusy` is listed
- Tasks tools are listed

## Verification Commands

Useful focused commands:

```sh
cd packages/app
bun test --preload ./happydom.ts ./src/extensions/registry.test.ts ./src/pages/session/session-extensions-install.test.ts ./src/pages/session/session-extensions-panel-model.test.ts
bun typecheck
```

```sh
cd packages/opencode
bun test test/server/httpapi-experimental.test.ts test/mcp/oauth-browser.test.ts test/mcp/lifecycle.test.ts
bun typecheck
```

When route/schema changes affect the JS SDK:

```sh
./packages/sdk/js/script/build.ts
```

## Common Failure Messages

`client_secret is missing`

The Google OAuth client secret was not available to the MCP server. Add `GOOGLE_OAUTH_CLIENT_SECRET` to setup metadata, registry environment placeholders, and the real app launch environment.

`Invalid or expired state parameter - potential CSRF attack`

Usually means the callback arrived after local pending OAuth state expired, or a stale browser tab completed an old flow. Use the current browser tab and keep the callback timeout realistic.

`invalid_token` immediately after successful auth

For local HTTP OAuth, check whether the runtime restarted the MCP on a new random port after `finishAuth`. Reconnect on the same URL that issued the token.

Agent says extension is installed but disabled

Check persisted project config. The managed MCP entry may still have `enabled: false` even though the live runtime was connected during setup.

## Design Defaults

Use these defaults unless there is a strong reason not to:

- app-bundled official registry only
- server accepts bundle payloads but does not know the marketplace
- project-local install only
- managed MCP keys are stable and deterministic
- managed skills use `<extension-id>:` frontmatter names
- OAuth uses existing MCP auth endpoints
- local OAuth-capable MCPs use `streamable-http`
- successful install/auth should leave the project usable after restart
