# Project Sidebar Controls

Implementation notes for the expanded sidebar project controls.

## What Changed

The expanded sidebar now has a Projects header toolbar with three controls.

The toolbar buttons are hidden by default and appear when the Projects header is hovered or focused, keeping the sidebar quiet until the user needs those actions.

The old per-section project headings are no longer rendered in this sidebar view, so the Projects toolbar is the single project header.

### Compact or Expand Projects

The first button toggles whether project sessions are visible.

- Expanded mode shows each project with its recent sessions.
- Compact mode shows only the project list.
- The toggle is local UI state inside `SidebarHub`.

Main file:

- `packages/app/src/pages/layout/sidebar-hub.tsx`

### Project View Menu

The second button opens a project view menu with three groups.

Organize:

- By project
- Recent projects
- Chronological list

Sort by:

- Created
- Updated

Show:

- All chats
- Relevant

The menu updates local sidebar state and reorders/filters the projects and their visible sessions.

Main files:

- `packages/app/src/pages/layout/sidebar-hub.tsx`
- `packages/app/src/i18n/en.ts`

### Add Project Menu

The third button opens a menu for adding projects.

- Start from scratch
- Use an existing folder

Both actions currently route through the existing project chooser flow. On desktop, the native directory picker already supports creating a directory from the picker.

Main files:

- `packages/app/src/pages/layout/sidebar-hub.tsx`
- `packages/app/src/pages/layout.tsx`

## Related Source Files

| File | Role |
|------|------|
| `packages/app/src/pages/layout/sidebar-hub.tsx` | Expanded sidebar layout, project toolbar, menus, compact state |
| `packages/app/src/pages/layout.tsx` | Wires project chooser callbacks into `SidebarHub` |
| `packages/app/src/i18n/en.ts` | Labels for project toolbar menus |
| `packages/ui/src/components/icon.tsx` | Adds the `star` icon used by Relevant |
