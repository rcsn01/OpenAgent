# Session Switching

Implementation history for seamless project/chat session switching, persistent UI shell, sidebar highlighting, and audio-toggle visibility.

## Problem Summary

Project sessions and general chat sessions were taking different paths through the app. Project sessions were routed through workspace/directory routes and had direct access to a known project directory. General chat sessions were routed through `/chat/:id`, then resolved asynchronously to a hidden backing workspace. Chat navigation had extra resolution work before the normal session UI could mount.

The main symptoms were:
- Navigating between project sessions was laggy
- Navigating from project sessions to chat sessions was worse
- Opening a chat session for the first time after app startup caused a short blank screen
- Session changes could remount large provider trees
- Sidebar highlighting could stick, causing multiple rows to look selected
- The audio/microphone toggle could disappear when unrelated provider data was loading

The fix was to treat route changes as state changes inside a persistent session shell, not as full UI teardown/recreate events.

## Architecture Changes

### Persistent Session Shell

The app was changed so the session UI is mounted once and kept alive across session route changes.

Key files: `packages/app/src/app.tsx`, `packages/app/src/pages/session-route-host.tsx`

What changed:
- The old route-specific layout mounting for chat/workspace sessions was replaced with a persistent route host
- `/chat/:id?` and `/:dir/session/:id?` now route into an empty route while the persistent host owns the real session surface
- `SessionRouteHost` wraps the session UI in the normal provider stack: `SDKProvider`, `SyncProvider`, `DataProvider`, `LocalProvider`
- A route change updates the active session/directory state instead of recreating the entire page shell

### App Route Resolution

The route layer was made responsible for resolving chat routes and workspace routes into the same shape.

Key file: `packages/app/src/context/app-route.tsx`

What changed:
- Added explicit support for `chat` and `workspace` route kinds
- Chat routes now resolve root session ID, hidden backing directory, canonical href, and readiness state
- Chat route hrefs preserve the hidden backing directory in a query parameter: `/chat/:id?d=<base64-directory>`
- Invalid chat session IDs are rejected early
- Chat routes can be considered ready from cached chat metadata or from the `?d=` directory param

### General Chat Route Cache

A small module-level route cache was added for general chat metadata.

Key file: `packages/app/src/context/general-chat-route-cache.ts`

What it stores: general chat records, session ID to hidden directory mapping, subscribers so route consumers can update without full reloads.

Supporting changes in `packages/app/src/context/general-chat.tsx`:
- General chat list loading writes through to the route cache
- `create`, `upsert`, and `remove` update the route cache
- The cache is not cleared during initial unloaded states

### Chat Navigation Warm Path

General chat navigation now warms the destination before navigation when possible.

Key file: `packages/app/src/pages/layout.tsx`

What changed:
- Opening a general chat calls `generalChats.upsert(chat)`, `prefetchSession(chat.session, "high")`, and builds chat hrefs with the hidden directory query param
- Search dialog chat selection also passes the backing directory

### Session Surface Hydration

Session data loading was changed so loading work does not block rendering the session shell.

Key file: `packages/app/src/pages/session.tsx`

What changed:
- Removed the `createResource` render-read that forced session sync into the render path
- Session sync became a fire-and-forget effect keyed by directory and session ID
- Composer readiness no longer waits for all messages to be loaded
- `MessageTimeline` stays mounted while messages load
- Removed the one-frame `deferRender` behavior
- File tree refresh/list work was deferred until after paint
- Follow-up drafts moved from workspace-local to global persistence

### Sync Provider and Global Child Store

The sync layer was adjusted so hidden chat directories do not eagerly bootstrap everything.

Key files: `packages/app/src/context/sync.tsx`, `packages/app/src/context/global-sync/child-store.ts`

What changed:
- SyncProvider set to `gate: false`, so provider readiness does not blank children
- Child stores accessed with `{ bootstrap: false }`
- Session sync supports `force` and `awaitPrefetch` options
- Initial message page size reduced from 80 to 20
- Path/MCP/LSP/provider queries are skipped unless the directory is explicitly enabled
- Provider fallback returns global providers when per-directory queries are not enabled

### Local State by Directory Key

Local session UI state was changed to use the app route instead of raw URL params.

Key file: `packages/app/src/context/local.tsx`

What changed:
- `LocalProvider` reads active session ID from `useAppRoute`
- Model selection persistence moved from per-workspace to global persistence keyed by `pathKey(directory)`
- Drafts are also keyed by normalized directory

## Chat and Sidebar

### Sidebar and Selection Highlighting

Key files: `packages/app/src/pages/layout/sidebar-items.tsx`, `packages/app/src/pages/layout/sidebar-hub.tsx`

What changed:
- Session row links use exact route matching with `end`
- Project session active state became an accessor instead of a stale captured boolean
- Active checks compare both session ID and normalized directory
- Sidebar rows warm stores without bootstrapping the full directory

### Project Session Improvements

Project sessions became faster after:
- Avoiding unnecessary child-store bootstrap in sidebar/session listings
- Keeping the session surface mounted
- Deferring file-tree work
- Removing render-blocking sync
- Reducing initial message sync size

### Chat Session Improvements

Chat sessions needed extra work because they are not truly directory-less. General chats are backed by hidden workspaces.

Specific fixes:
- Cache chat-to-directory metadata
- Carry hidden directory through the route via `?d=`
- Upsert and prefetch chat session records before navigation
- Make `/chat/:id` resolve into the same session host as project sessions
- Avoid bootstrapping full hidden workspace state when only session data is needed

## Blank Screen and Audio

### Blank Screen Investigation

The blank flash appeared when the active route briefly had no ready directory or when provider/context gates delayed children.

**Causes:**
- Chat route directory resolution was async
- `SessionRouteHost` rendered only when `route.ready() && route.directory()`
- `SyncProvider` originally gated children while loading
- Session page had render-blocking resource reads and one-frame defer logic

**Fixes:**
- Cached chat route metadata
- Passed chat directory in route hrefs
- Made `SyncProvider` non-gating
- Removed render-blocking session sync
- Kept timeline/composer shell mounted while messages load
- Deferred file-tree refresh until after first paint

### Audio Toggle Finding

The microphone toggle could disappear because it was inside the same provider-loading block as model controls. If provider or agent queries were loading, the whole block disappeared.

**Fix:** Moved the toggle and voice settings outside the provider-loading gate in `packages/app/src/components/prompt-input.tsx`. The controls now stay mounted and disable themselves only when voice is unsupported or prompt mode is not normal.

## Mental Model

### Files Changed

Session routing and persistent shell:
- `packages/app/src/app.tsx`, `packages/app/src/context/app-route.tsx`, `packages/app/src/pages/session-route-host.tsx`

General chat route cache and navigation:
- `packages/app/src/context/general-chat-route-cache.ts`, `packages/app/src/context/general-chat.tsx`, `packages/app/src/pages/layout.tsx`

Sidebar and selection state:
- `packages/app/src/pages/layout/sidebar-items.tsx`, `packages/app/src/pages/layout/sidebar-hub.tsx`

Sync and hidden-directory bootstrap:
- `packages/app/src/context/sync.tsx`, `packages/app/src/context/global-sync/child-store.ts`

Session page render:
- `packages/app/src/pages/session.tsx`

Local UI state:
- `packages/app/src/context/local.tsx`

Voice UI:
- `packages/app/src/components/prompt-input.tsx`

### Going Forward

The desired architecture:
```
Sidebar click
  -> update route state immediately
  -> route resolves session ID + directory from cache or URL
  -> persistent session shell stays mounted
  -> sync fetches missing data in the background
  -> timeline/composer keep their structure
  -> sidebar active highlight updates from route state
```

The anti-pattern to avoid:
```
Sidebar click
  -> route component unmounts
  -> providers remount
  -> hidden chat directory resolves asynchronously
  -> sync bootstraps whole workspace
  -> UI shows blank/loading shell
```

The closer the GUI stays to the first model, the closer it will feel to instant session switching.
