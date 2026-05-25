<!-- GSD:project-start source:PROJECT.md -->
## Project

**ServerDeck**

ServerDeck is a mobile-friendly personal server dashboard that gives you a real-time view of all Docker containers running on your server and a direct SSH terminal in the browser. It's built for a single user who wants to monitor and manage their server from their phone without needing a separate SSH app.

**Core Value:** From any phone browser, see what's running on your server and drop into a shell — no apps, no VPN setup, no switching tools.

### Constraints

- **Compatibility**: Must work in mobile Safari and Chrome on iOS/Android — no desktop-only dependencies
- **Deployment**: Single Node.js process on the server — no external services or databases needed
- **Security**: Protected by login; all Docker and SSH operations require authentication
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Backend
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Fastify** | `^5.8.5` | HTTP server + route handling | Plugin-based architecture maps cleanly to our features (WebSocket, JWT, static serving each have official plugins). 2–3× faster than Express. TypeScript-native. More structured than Hono for a Node.js-only server. |
| **@fastify/websocket** | `^11.2.0` | WebSocket upgrade for terminal + log streaming | Official Fastify plugin; wraps `ws` under the hood. Per-route WebSocket handlers with full Fastify lifecycle hooks (auth runs before upgrade). |
| **@fastify/jwt** | `^10.1.0` | Stateless auth token | JWT stored in httpOnly cookie — no session store needed, no external DB dependency. Signs/verifies with a single secret stored in env. |
| **@fastify/cookie** | `^11.0.2` | Cookie parsing for JWT extraction | Required by `@fastify/jwt` to read token from httpOnly cookie. Provides CSRF-safe auth pattern for browser clients. |
| **@fastify/static** | `^9.1.3` | Serve compiled React frontend | Serves `dist/` from Vite build. Single process handles API + static assets. No nginx required. |
| **dockerode** | `^5.0.0` | Docker Engine API client | The standard Node.js Docker library. Communicates via `/var/run/docker.sock`. Supports container lifecycle (start/stop/restart), real-time log streaming (`follow: true`), and event subscriptions. 4.9k GitHub stars, maintained actively (last commit 2026-05-24). |
| **ssh2** | `^1.17.0` | SSH shell session to localhost | Pure-JavaScript SSH client — no native compilation. Provides PTY-backed shell streams bridgeable to a WebSocket. Handles password auth and key auth. 5.8k stars, updated 2026-05-23. Preferred over `node-pty` for an SSH-to-localhost approach because it avoids native binaries and keeps the architecture consistent (authenticate via existing server SSH, not just spawning a raw shell). |
| **bcryptjs** | `^3.0.3` | Password hashing | Pure-JS bcrypt (no native module). Hash the admin password once at setup, store in env config. Timing-safe compare on login. |
| **TypeScript** | `^5.x` | Type safety across backend | Catches errors at build time. All packages above ship types or have `@types/`. |
### Frontend
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **React** | `^19.2.6` | UI framework | Largest ecosystem, best xterm.js / Tailwind / shadcn integration. React 19 brings concurrent features and the Actions API for cleaner async form handling (login form). |
| **Vite** | `^8.0.14` | Build tool + dev server | Fastest HMR, native ESM. First-class React plugin. Produces optimized `dist/` that Fastify serves statically. |
| **TypeScript** | `^5.x` | Type safety across frontend | Shared types between frontend/backend via a `shared/` directory is idiomatic with a monorepo-lite setup. |
| **@xterm/xterm** | `^5.6.0` | Browser terminal emulator | Powers VS Code's integrated terminal. 20.6k GitHub stars. Handles ANSI escape codes, 256-color, mouse events. Mobile-compatible (virtual keyboard appears on tap in iOS Safari). The `@xterm/xterm` scoped package is the current form — `xterm` (unscoped) is the legacy form. |
| **@xterm/addon-attach** | `^0.12.0` | Wire terminal to WebSocket | `AttachAddon` makes xterm.js bidirectionally talk to a WebSocket in 4 lines. Terminal → WS → ssh2 stream → shell. |
| **@xterm/addon-fit** | `^0.11.0` | Responsive terminal sizing | Calculates `cols`/`rows` from container's pixel size. Essential for mobile — when the keyboard appears and shrinks the viewport, FitAddon recalculates and sends a `resize` event to the server. |
| **Tailwind CSS** | `^4.3.0` | Utility CSS | v4 is stable and ships as a Vite plugin (`@tailwindcss/vite`). Mobile-first by default. No separate config file needed in v4. Used by shadcn/ui v4. |
| **shadcn/ui** | `latest CLI` | Component library | Not an npm package — components are copied into your project. shadcn now officially supports Tailwind v4 (confirmed: `apps/v4` docs). Provides Button, Card, Badge, Dialog, Tabs, ScrollArea out of the box. All accessible (Radix UI primitives). |
| **TanStack Query** | `^5.100.14` | Server state / data fetching | Polling Docker container list every 3s with `refetchInterval` is idiomatic TanStack Query usage. Handles loading/error states, optimistic updates for start/stop/restart actions, and automatic background refresh. |
| **Zustand** | `^5.0.13` | Client-side global state | Lightweight (1KB). Holds transient UI state (active terminal session ID, selected container, etc.) that doesn't belong in TanStack Query. |
| **Lucide React** | `^1.16.0` | Icon set | Matches shadcn/ui's assumed icon library. Clean, consistent, tree-shakeable. |
### Infrastructure / Tooling
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Node.js** | `>=20 LTS` | Runtime | v20 is current LTS. `node-gyp` (if any native deps sneak in) requires >= 18. |
| **ws** | `^8.21.0` | WebSocket protocol (transitive) | `@fastify/websocket` depends on this. No direct usage needed. |
| **dotenv** | `^16.x` | Environment configuration | Store `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `PORT`, `SSH_HOST`/`SSH_USER`/`SSH_KEY_PATH` in `.env`. Never commit. |
| **tsx** | `^4.x` | TypeScript execution in dev | Run backend `src/index.ts` directly without a build step during development. |
| **concurrently** | `^9.x` | Dev orchestration | Run Vite dev server + Fastify backend in one terminal during development. |
## Architecture-Critical Integration Notes
### WebSocket → SSH Terminal Flow
### WebSocket → Docker Log Streaming Flow
### Auth Flow (httpOnly JWT Cookie)
## Mobile-Specific Considerations
| Concern | Solution |
|---------|----------|
| **Virtual keyboard shrinks terminal viewport** | `FitAddon.fit()` in a `ResizeObserver` on the terminal container. Fire `resize` message to server after each fit. |
| **iOS Safari 100vh bug** (keyboard changes viewport height) | Use `dvh` units (dynamic viewport height) in Tailwind: `h-[100dvh]`. Supported in iOS 16+, Android Chrome 108+. |
| **Touch scrolling in xterm.js** | xterm.js supports touch scroll natively. Do not add `overflow: hidden` on the terminal container. |
| **Tap targets** | shadcn/ui components default to 44px touch targets. Verify container action buttons are min `h-11`. |
| **No persistent SSH connection on screen lock** | Handle `ws.onclose` in the terminal and show a "Reconnect" button. Do not auto-reconnect without user intent (unexpected on mobile). |
| **HTTP Secure context required for cookies** | Run behind a reverse proxy with TLS (Caddy recommended in a self-hosted context). `Secure` cookie flag requires HTTPS. |
## Alternatives Considered and Rejected
| Category | Recommended | Alternative | Why Rejected |
|----------|-------------|-------------|--------------|
| Backend framework | Fastify 5 | Express 5 | Express 5 just left beta; plugin ecosystem sparse for WebSocket+auth combos. Express 4 is maintenance-only. |
| Backend framework | Fastify 5 | Hono | Hono's Node.js WebSocket requires manual `ws` server wiring alongside Hono. Extra complexity for no benefit in a server-only app. |
| Docker API | dockerode | Docker SDK for JS (`@docker/sdk`) | Docker's official Node.js SDK is very new (alpha), less community usage, fewer examples. Dockerode is the de facto standard with 5+ years of production use. |
| SSH terminal | ssh2 | node-pty | node-pty is a native addon requiring compilation. Breaks in Docker environments after Node.js version upgrades. ssh2 is pure JS. |
| SSH terminal | ssh2 | wetty / gotty (existing tool) | Third-party processes add operational complexity. Our app needs auth integration — a standalone wetty sidecar can't share our JWT session. |
| Frontend framework | React 19 | Vue 3 | xterm.js, shadcn/ui, and TanStack Query are React-first. Vue support exists but is secondary. |
| Frontend framework | React 19 | Svelte 5 | shadcn/ui does not have an official Svelte port. Would require a different component library, reducing consistency. |
| UI library | shadcn/ui + Tailwind v4 | Mantine | Mantine is excellent but ships its own CSS-in-JS system; Tailwind is more maintainable for customization. shadcn copies code into the project — no version lock-in. |
| Auth | httpOnly JWT cookie | localStorage JWT | localStorage is accessible to XSS; httpOnly cookies are not. For an internet-exposed tool this matters. |
| Auth | httpOnly JWT cookie | express-session + in-memory store | Requires a session store; memory store loses sessions on restart. httpOnly JWT is stateless and works across restarts. |
## Complete Installation Reference
# --- Backend (Node.js / Fastify) ---
# --- Frontend (React / Vite) ---
# --- shadcn/ui (run in frontend directory) ---
# Select: Tailwind v4, Vite, React, TypeScript
# Add components as needed:
## Version Summary Table
| Package | Version |
|---------|---------|
| fastify | 5.8.5 |
| @fastify/websocket | 11.2.0 |
| @fastify/jwt | 10.1.0 |
| @fastify/cookie | 11.0.2 |
| @fastify/static | 9.1.3 |
| dockerode | 5.0.0 |
| ssh2 | 1.17.0 |
| bcryptjs | 3.0.3 |
| react / react-dom | 19.2.6 |
| vite | 8.0.14 |
| tailwindcss | 4.3.0 |
| @xterm/xterm | 5.6.0 |
| @xterm/addon-attach | 0.12.0 |
| @xterm/addon-fit | 0.11.0 |
| @tanstack/react-query | 5.100.14 |
| zustand | 5.0.13 |
| lucide-react | 1.16.0 |
| ws (transitive) | 8.21.0 |
## Sources
- dockerode: Context7 `/apocas/dockerode` (HIGH confidence) · GitHub stars: 4,896 · Updated 2026-05-24
- ssh2: Context7 `/mscdex/ssh2` (HIGH confidence) · GitHub stars: 5,780 · Updated 2026-05-23
- xterm.js: Context7 `/xtermjs/xterm.js` (HIGH confidence) · GitHub stars: 20,591 · Updated 2026-05-25
- node-pty: Context7 `/microsoft/node-pty` (HIGH confidence) · GitHub stars: 1,939 · Updated 2026-05-25
- Fastify: Context7 `/fastify/fastify` (HIGH confidence) — v5.8.5 confirmed via npm registry
- Hono: Context7 `/websites/hono_dev` (HIGH confidence) — WebSocket on Node.js pattern confirmed
- shadcn/ui: Context7 `/shadcn-ui/ui` (HIGH confidence) — Tailwind v4 + Vite installation confirmed in `apps/v4` docs
- All package versions: npm registry (verified 2025-05-25)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
