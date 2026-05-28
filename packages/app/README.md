# @opencode-ai/app

Solid/Vite frontend shell for OpenAgent.

The app runs without a backend and uses the frontend null runtime for empty states.

```sh
bun --cwd packages/app dev
bun --cwd packages/app build
bun --cwd packages/app test:unit
```

Playwright starts only the Vite dev server for frontend smoke tests.
