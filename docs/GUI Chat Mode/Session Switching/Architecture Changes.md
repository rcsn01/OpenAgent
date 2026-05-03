# Architecture Changes

## Persistent Session Shell

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

## App Route Resolution

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

## General Chat Route Cache

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

## Chat Navigation Warm Path

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

## Session Surface Hydration

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

## Sync Provider and Global Child Store

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

## Local State by Directory Key

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
