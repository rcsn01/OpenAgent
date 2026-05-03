# Session Switching Performance Implementation

This note records the session-management and UI performance work done to make GUI navigation between project sessions and general chat sessions feel seamless.

The core product goal was:

- Switching sessions should not remount or blank the whole UI.
- Switching between different session types, especially project sessions and `/chat` sessions, should feel instant.
- A never-before-opened session should not cause a full-screen flash.
- Sidebar selection highlighting should update immediately and should never leave multiple sessions highlighted.
- General chat sessions should behave like project sessions from the UI shell's perspective.

## Problem Summary

Project sessions and general chat sessions were taking different paths through the app.

Project sessions were routed through workspace/directory routes and had direct access to a known project directory. General chat sessions were routed through `/chat/:id`, then resolved asynchronously to a hidden backing workspace. That meant chat navigation had extra resolution work before the normal session UI could mount.

The main symptoms were:

- Navigating between project sessions was laggy.
- Navigating from project sessions to chat sessions was worse.
- Opening a chat session for the first time after app startup caused a short blank screen.
- Session changes could remount large provider trees.
- Sidebar highlighting could stick, causing multiple rows to look selected.
- The audio/microphone toggle could disappear when unrelated provider data was loading.

The architectural direction was to treat route changes as state changes inside a persistent session shell, not as full UI teardown/recreate events.

## Architecture Changes

### Persistent Session Shell

The app was changed so the session UI is mounted once and kept alive across session route changes.

Key files:

- `packages/app/src/app.tsx`
- `packages/app/src/pages/session-route-host.tsx`

What changed:

- The old route-specific layout mounting for chat/workspace sessions was replaced with a persistent route host.
- `/chat/:id?` and `/:dir/session/:id?` now route into an empty route while the persistent host owns the real session surface.
- `SessionRouteHost` wraps the session UI in the normal provider stack:
  - `SDKProvider`
  - `SyncProvider`
  - `DataProvider`
  - `LocalProvider`
- This makes a route change update the active session/directory state instead of recreating the entire page shell.

Why:

- Claude/Codex-style instant switching comes from keeping the expensive UI and provider tree warm.
- The app should swap session data inside an already-mounted shell rather than remounting the shell.

### App Route Resolution

The route layer was made responsible for resolving chat routes and workspace routes into the same shape.

Key file:

- `packages/app/src/context/app-route.tsx`

What changed:

- Added explicit support for `chat` and `workspace` route kinds.
- Chat routes now resolve:
  - root session ID
  - hidden backing directory
  - canonical href
  - readiness state
- Chat route hrefs preserve the hidden backing directory in a query parameter:

```text
/chat/:id?d=<base64-directory>
```

- Invalid chat session IDs are rejected early.
- Invalid workspace slugs navigate back to a safe route.
- Chat routes can be considered ready from cached chat metadata or from the `?d=` directory param, instead of always waiting for a fresh async load.

Why:

- The blank screen came from the UI needing to wait for hidden chat directory resolution.
- Passing and caching the backing directory lets chat sessions behave more like project sessions during navigation.

### General Chat Route Cache

A small module-level route cache was added for general chat metadata.

Key file:

- `packages/app/src/context/general-chat-route-cache.ts`

What it stores:

- General chat records
- Session ID to hidden directory mapping
- Subscribers so route consumers can update without full reloads

Supporting changes:

- `packages/app/src/context/general-chat.tsx`

What changed:

- General chat list loading now writes through to the route cache.
- `create`, `upsert`, and `remove` update the route cache.
- The cache is not cleared during initial unloaded states.

Why:

- On first app startup, general chat metadata may not be available yet.
- Once chat metadata is known, future navigations should not repeat the expensive async path.
- The UI needs a stable local answer for "what directory backs this chat session?"

### Chat Navigation Warm Path

General chat navigation now warms the destination before navigation when possible.

Key file:

- `packages/app/src/pages/layout.tsx`

What changed:

- Opening a general chat calls `generalChats.upsert(chat)`.
- It calls `prefetchSession(chat.session, "high")`.
- It builds chat hrefs with the hidden directory query param when the directory is known.
- Search dialog chat selection also passes the backing directory.

Why:

- Clicking a chat row should not start from cold state.
- The route should receive enough information to render immediately.

### Session Surface Hydration

Session data loading was changed so loading work does not block rendering the session shell.

Key file:

- `packages/app/src/pages/session.tsx`

What changed:

- Removed the `createResource` render-read that forced session sync into the render path.
- Session sync became a fire-and-forget effect keyed by directory and session ID.
- Composer readiness no longer waits for all messages to be loaded.
- `MessageTimeline` stays mounted while messages load.
- Removed the one-frame `deferRender` behavior that intentionally blanked or delayed the UI on session changes.
- File tree refresh/list work was deferred until after paint.
- Follow-up drafts moved from workspace-local persistence to global persistence keyed by normalized directory.

Why:

- Session switching should immediately show the existing shell and progressively fill in data.
- Loading messages should not hide the composer or timeline container.
- Heavy file-tree work should not compete with the first paint after navigation.

### Sync Provider and Global Child Store

The sync layer was adjusted so hidden chat directories do not eagerly bootstrap everything.

Key files:

- `packages/app/src/context/sync.tsx`
- `packages/app/src/context/global-sync/child-store.ts`

What changed in `SyncProvider`:

- The context was set to `gate: false`, so provider readiness does not blank children while loading.
- Child stores are usually accessed with `{ bootstrap: false }`.
- Session sync supports options like `force` and `awaitPrefetch`.
- Prefetch promises are only awaited when requested.
- Initial message page size was reduced from `80` to `20`.

What changed in child stores:

- Added `queryEnabled` tracking per directory.
- Path/MCP/LSP/provider queries are skipped unless the directory is explicitly enabled.
- `child()` and `peek()` only enable queries for bootstrap paths.
- `disposeDirectory()` disables queries.
- Provider fallback returns global providers when per-directory provider queries are not enabled.
- Path fallback returns a safe lightweight path object.

Why:

- Chat sessions live in hidden directories, but most of the UI only needs session data immediately.
- Eagerly bootstrapping path, provider, MCP, and LSP state for every hidden chat directory causes expensive work during navigation.
- Provider gating was one cause of blanking.

### Local State by Directory Key

Local session UI state was changed to use the app route instead of raw URL params.

Key file:

- `packages/app/src/context/local.tsx`

What changed:

- `LocalProvider` now reads active session ID from `useAppRoute`.
- Model selection persistence moved from per-workspace persistence to global persistence keyed by `pathKey(directory)`.
- Drafts are also keyed by normalized directory.
- Workspace slug is derived from the current resolved directory.

Why:

- A persistent session shell means URL params are not the only source of truth.
- Project sessions and hidden chat sessions both need stable local state keyed by their resolved directory.

## Sidebar and Selection Highlighting

Sidebar session rows were changed so active state is exact and directory-aware.

Key files:

- `packages/app/src/pages/layout/sidebar-items.tsx`
- `packages/app/src/pages/layout/sidebar-hub.tsx`

What changed:

- Session row links use exact route matching with `end`.
- Project session active state became an accessor instead of a stale captured boolean.
- Active checks compare both session ID and normalized directory.
- Sidebar rows warm stores without bootstrapping the full directory.

Why:

- The previous highlight state could stay active after switching, making many sessions look selected.
- Session IDs are not enough when there are multiple backing directories.
- Solid accessors are needed so row highlighting updates reactively and immediately.

## Project Session Improvements

Project sessions became faster after:

- Avoiding unnecessary child-store bootstrap in sidebar/session listings.
- Keeping the session surface mounted.
- Deferring file-tree work.
- Removing render-blocking sync.
- Reducing initial message sync size.

These changes mostly aligned project sessions with the "warm shell, swap data" architecture.

## Chat Session Improvements

Chat sessions needed extra work because they are not truly directory-less.

General chats are backed by hidden workspaces. The UI URL hides that detail, but the session runtime still requires a real directory.

Specific chat-session fixes:

- Cache chat-to-directory metadata.
- Carry hidden directory through the route via `?d=`.
- Upsert and prefetch chat session records before navigation.
- Make `/chat/:id` resolve into the same session host as project sessions.
- Avoid bootstrapping full hidden workspace state when only session data is needed.

Remaining risk:

- A cold direct-opened `/chat/:id` with no cached metadata and no `?d=` still needs async lookup.
- To make that case visually perfect, the host should keep the previous valid session surface visible until the next route has a resolved directory.

## Blank Screen Investigation

The blank flash appeared when the active route briefly had no ready directory or when provider/context gates delayed children.

Causes identified:

- Chat route directory resolution was async.
- `SessionRouteHost` rendered only when `route.ready() && route.directory()`.
- `SyncProvider` originally gated children while loading.
- Session page had render-blocking resource reads and one-frame defer logic.

Fixes applied:

- Cached chat route metadata.
- Passed chat directory in route hrefs.
- Made `SyncProvider` non-gating.
- Removed render-blocking session sync from `session.tsx`.
- Kept timeline/composer shell mounted while messages load.
- Deferred file-tree refresh until after first paint.

Possible next hardening step:

- Make `SessionRouteHost` keep the last valid directory/session mounted until the next route is fully ready, instead of returning nothing during transient unresolved route states.

## Audio Toggle Finding

The audio capability was not removed.

Relevant history:

- `b26eef8b9` — `Add microphone toggle to prompt input`
- `c1a9ae07e` — `Add local voice transcription support`
- `72efc327a` — `Add press-to-talk and refactor voice flow`
- `ee668c386` — `Add native speech capture gain and voice UI`

The reason the microphone toggle could disappear was UI coupling:

- The mic toggle and `VoiceSettingsPopover` were inside the same provider-loading block as model controls.
- If provider or agent queries were loading, the whole block disappeared.
- That made voice look removed even though speech code was still present.

Fix applied:

- Moved the microphone toggle and voice settings outside the provider-loading gate in `packages/app/src/components/prompt-input.tsx`.
- The controls now stay mounted.
- They disable themselves only when voice is unsupported or prompt mode is not normal.

## Files Changed During This Work

Session routing and persistent shell:

- `packages/app/src/app.tsx`
- `packages/app/src/context/app-route.tsx`
- `packages/app/src/pages/session-route-host.tsx`

General chat route cache and navigation:

- `packages/app/src/context/general-chat-route-cache.ts`
- `packages/app/src/context/general-chat.tsx`
- `packages/app/src/pages/layout.tsx`

Sidebar and selection state:

- `packages/app/src/pages/layout/sidebar-items.tsx`
- `packages/app/src/pages/layout/sidebar-hub.tsx`

Sync and hidden-directory bootstrap behavior:

- `packages/app/src/context/sync.tsx`
- `packages/app/src/context/global-sync/child-store.ts`

Session page render behavior:

- `packages/app/src/pages/session.tsx`

Local UI state:

- `packages/app/src/context/local.tsx`

Voice UI:

- `packages/app/src/components/prompt-input.tsx`

Documentation:

- `obsidian/GUI Chat Mode/Session Switching Performance Implementation.md`
- `obsidian/GUI Chat Mode/Index.md`
- `obsidian/README.md`

## Verification Run

The app package typecheck was run after the latest UI/audio change:

```bash
cd packages/app
bun typecheck
```

Result:

```text
$ tsgo -b
```

No type errors were reported.

## Mental Model Going Forward

The desired architecture is:

```text
Sidebar click
  -> update route state immediately
  -> route resolves session ID + directory from cache or URL
  -> persistent session shell stays mounted
  -> sync fetches missing data in the background
  -> timeline/composer keep their structure
  -> sidebar active highlight updates from route state
```

The anti-pattern to avoid is:

```text
Sidebar click
  -> route component unmounts
  -> providers remount
  -> hidden chat directory resolves asynchronously
  -> sync bootstraps whole workspace
  -> UI shows blank/loading shell
```

The closer the GUI stays to the first model, the closer it will feel to Claude/Codex-style instant session switching.

