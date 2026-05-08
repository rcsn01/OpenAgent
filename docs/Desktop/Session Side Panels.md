# Session Side Panels

The session right side uses one shared shell with three first-class panels:

- **Review**: Git changes, open file tabs, and the optional file tree
- **Extensions**: project-scoped extension install/connect/auth management
- **Subagents**: background task and subagent graph visibility

## Structure

The shared shell lives at:

```text
packages/app/src/pages/session/side-panel/index.tsx
```

It is responsible for desktop-only visibility, width animation, accessibility state, and choosing the active panel from session layout state.

Each panel owns its own UI and supporting model/helper files:

```text
packages/app/src/pages/session/side-panel/
  index.tsx
  review/
    index.tsx
    file-tabs.tsx
    file-tab-scroll.ts
    file-tab-scroll.test.ts
  extensions/
    index.tsx
    install.ts
    install.test.ts
    model.ts
    model.test.ts
  subagents/
    index.tsx
    model.ts
    model.test.ts
```

## Review And File Tree

The file tree is no longer an independent side panel. It is owned by the Review panel.

Behavior:

- The top app bar has a Review/Git toggle, but no standalone file tree toggle.
- The file tree toggle is inside the Review panel tab bar beside the open-file `+` button.
- The file tree can only be opened or closed while Review is open.
- Closing Review hides both Git changes and the file tree.
- Extensions and Subagents do not render the file tree.

The persisted `layout.fileTree` state still stores file tree width, active tab, and open state. That state no longer opens the side panel by itself; it is only honored when the Review panel is active.

## Commands

`review.toggle` opens and closes the Review panel.

`fileTree.toggle` remains available for keybinding/command-palette use, but it is disabled/no-op unless the Review panel is already open.

## Verification

Focused checks for this area:

```sh
cd packages/app
bun test --preload ./happydom.ts ./src/pages/session/side-panel/review/file-tab-scroll.test.ts ./src/pages/session/side-panel/subagents/model.test.ts ./src/pages/session/side-panel/extensions/model.test.ts ./src/pages/session/side-panel/extensions/install.test.ts ./src/pages/session/helpers.test.ts
bun typecheck
```
