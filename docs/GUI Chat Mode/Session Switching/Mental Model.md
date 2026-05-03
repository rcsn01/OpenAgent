# Mental Model

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
