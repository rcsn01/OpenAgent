# Blank Screen and Audio

## Blank Screen Investigation

The blank flash appeared when the active route briefly had no ready directory or when provider/context gates delayed children.

### Causes Identified

- Chat route directory resolution was async.
- `SessionRouteHost` rendered only when `route.ready() && route.directory()`.
- `SyncProvider` originally gated children while loading.
- Session page had render-blocking resource reads and one-frame defer logic.

### Fixes Applied

- Cached chat route metadata.
- Passed chat directory in route hrefs.
- Made `SyncProvider` non-gating.
- Removed render-blocking session sync from `session.tsx`.
- Kept timeline/composer shell mounted while messages load.
- Deferred file-tree refresh until after first paint.

### Possible Next Hardening Step

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
