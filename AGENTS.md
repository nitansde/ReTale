<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Dev Server
When you are trying to test or asked to start a server during development, always use port 3000 and kill the server after you are done. If port 3000 is occupied, kill the existing server and restart on 3000 instead of choosing a different port. This rule is for dev only. The app's default `npm run dev` workflow may target a user-facing Tailscale port, but automated/manual testing must still pass an explicit port 3000 override.
