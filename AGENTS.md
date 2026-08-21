<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Dev Server
When you are trying to test or asked to start a server during development, always use port 3000 and kill the server after you are done. If port 3000 is occupied, kill the existing server and restart on 3000 instead of choosing a different port. This rule is for dev only. The app's default `npm run dev` workflow may target a user-facing Tailscale port, but automated/manual testing must still pass an explicit port 3000 override.

# Production-facing Server
After every development task, ensure the project's production-facing server is running via `npm run dev:prod`, listening on `0.0.0.0:14500`, and leave it running after the task is complete. Automated and manual development testing must still use port 3000 and stop that test server afterward.
