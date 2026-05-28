# Desktop Shell

The desktop package wraps `@opencode-ai/app` in Electron and starts the renderer directly.

Retained native capabilities:

- file, directory, and save dialogs
- persistent Electron storage
- opening files, folders, and external links
- notifications and window focus controls
- titlebar, zoom, and background color integration
- updater checks and install flow
- markdown parsing
- WSL path conversion helpers
- speech capture and transcription APIs

The former local service process, SQLite migration window, shared service discovery, backend startup, and computer-use bridge are no longer part of the desktop startup path.
