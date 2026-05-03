# Problem Summary

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
