# Technology Stack

**Project:** ServerDeck — Self-hosted personal server dashboard
**Researched:** 2025-05-25
**Confidence:** HIGH (all core libraries verified via Context7 + npm registry; all versions current)

---

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

> **Why Fastify over Express:** Express 4 is in maintenance mode. Express 5 just released but ecosystem is sparse. Fastify 5 has a rich, official plugin ecosystem, built-in schema validation (JSON Schema / Zod), and TypeScript-first design.
>
> **Why Fastify over Hono:** Hono's WebSocket support on Node.js requires juggling a separate `ws` instance alongside the Hono app (see `@hono/node-server` docs). Fastify's `@fastify/websocket` integrates cleanly into the route level including auth hooks. For a server-side-only app with no edge runtime requirement, Fastify is the better fit.
>
> **Why ssh2 over node-pty for SSH:** `node-pty` is a native module requiring compilation (`node-gyp`). In a Docker container or after Node.js upgrades, rebuilding native modules is a common failure point. `ssh2` is pure JavaScript. The trade-off: `ssh2` requires the server to have SSH daemon running and a valid credential — but this is true by definition for a server management tool. It also gives you a real SSH shell (not just a raw process spawn), which is more correct for the use case.

---

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

---

### Infrastructure / Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Node.js** | `>=20 LTS` | Runtime | v20 is current LTS. `node-gyp` (if any native deps sneak in) requires >= 18. |
| **ws** | `^8.21.0` | WebSocket protocol (transitive) | `@fastify/websocket` depends on this. No direct usage needed. |
| **dotenv** | `^16.x` | Environment configuration | Store `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `PORT`, `SSH_HOST`/`SSH_USER`/`SSH_KEY_PATH` in `.env`. Never commit. |
| **tsx** | `^4.x` | TypeScript execution in dev | Run backend `src/index.ts` directly without a build step during development. |
| **concurrently** | `^9.x` | Dev orchestration | Run Vite dev server + Fastify backend in one terminal during development. |

---

## Architecture-Critical Integration Notes

### WebSocket → SSH Terminal Flow

```
Mobile browser
  └─ WebSocket ws://host/api/terminal
       └─ @fastify/websocket handler (auth verified via JWT cookie before upgrade)
            └─ ssh2 Client.shell({ term: 'xterm-256color' })
                 └─ stream.on('data') → ws.send()
                 └─ ws.on('message') → stream.write()
                 └─ resize message → stream.setWindow(rows, cols)
```

The frontend xterm.js + `@xterm/addon-attach` handles the other end:
```typescript
const socket = new WebSocket('/api/terminal');
const attachAddon = new AttachAddon(socket, { bidirectional: true });
terminal.loadAddon(attachAddon);
terminal.loadAddon(new FitAddon());
terminal.onResize(({ cols, rows }) =>
  socket.send(JSON.stringify({ type: 'resize', cols, rows }))
);
```

### WebSocket → Docker Log Streaming Flow

```
Mobile browser
  └─ WebSocket ws://host/api/containers/:id/logs
       └─ @fastify/websocket handler
            └─ dockerode container.logs({ follow: true, stdout: true, stderr: true })
                 └─ container.modem.demuxStream(stream, passThrough, passThrough)
                 └─ passThrough.on('data') → ws.send(chunk.toString())
                 └─ ws.on('close') → stream.destroy()
```

### Auth Flow (httpOnly JWT Cookie)

```
POST /api/auth/login { username, password }
  → bcryptjs.compare(password, ADMIN_PASSWORD_HASH)
  → reply.setCookie('token', jwt.sign(...), { httpOnly: true, secure: true, sameSite: 'strict' })
  → 200 OK

All protected routes:
  → fastify.addHook('onRequest', fastify.authenticate)
  → fastify.authenticate reads cookie 'token', verifies JWT signature
  → 401 if missing/invalid

WebSocket upgrade:
  → @fastify/websocket triggers same hook before upgrade
  → WS connection only established if auth passes
```

---

## Mobile-Specific Considerations

| Concern | Solution |
|---------|----------|
| **Virtual keyboard shrinks terminal viewport** | `FitAddon.fit()` in a `ResizeObserver` on the terminal container. Fire `resize` message to server after each fit. |
| **iOS Safari 100vh bug** (keyboard changes viewport height) | Use `dvh` units (dynamic viewport height) in Tailwind: `h-[100dvh]`. Supported in iOS 16+, Android Chrome 108+. |
| **Touch scrolling in xterm.js** | xterm.js supports touch scroll natively. Do not add `overflow: hidden` on the terminal container. |
| **Tap targets** | shadcn/ui components default to 44px touch targets. Verify container action buttons are min `h-11`. |
| **No persistent SSH connection on screen lock** | Handle `ws.onclose` in the terminal and show a "Reconnect" button. Do not auto-reconnect without user intent (unexpected on mobile). |
| **HTTP Secure context required for cookies** | Run behind a reverse proxy with TLS (Caddy recommended in a self-hosted context). `Secure` cookie flag requires HTTPS. |

---

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

---

## Complete Installation Reference

```bash
# --- Backend (Node.js / Fastify) ---
npm install fastify @fastify/websocket @fastify/jwt @fastify/cookie @fastify/static
npm install dockerode ssh2 bcryptjs
npm install -D typescript tsx @types/node @types/dockerode @types/ssh2 @types/bcryptjs

# --- Frontend (React / Vite) ---
npm install react react-dom
npm install @xterm/xterm @xterm/addon-attach @xterm/addon-fit
npm install @tanstack/react-query zustand lucide-react
npm install -D vite @vitejs/plugin-react typescript tailwindcss @tailwindcss/vite

# --- shadcn/ui (run in frontend directory) ---
npx shadcn@latest init
# Select: Tailwind v4, Vite, React, TypeScript

# Add components as needed:
npx shadcn@latest add button card badge dialog tabs scroll-area
```

---

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

---

## Sources

- dockerode: Context7 `/apocas/dockerode` (HIGH confidence) · GitHub stars: 4,896 · Updated 2026-05-24
- ssh2: Context7 `/mscdex/ssh2` (HIGH confidence) · GitHub stars: 5,780 · Updated 2026-05-23
- xterm.js: Context7 `/xtermjs/xterm.js` (HIGH confidence) · GitHub stars: 20,591 · Updated 2026-05-25
- node-pty: Context7 `/microsoft/node-pty` (HIGH confidence) · GitHub stars: 1,939 · Updated 2026-05-25
- Fastify: Context7 `/fastify/fastify` (HIGH confidence) — v5.8.5 confirmed via npm registry
- Hono: Context7 `/websites/hono_dev` (HIGH confidence) — WebSocket on Node.js pattern confirmed
- shadcn/ui: Context7 `/shadcn-ui/ui` (HIGH confidence) — Tailwind v4 + Vite installation confirmed in `apps/v4` docs
- All package versions: npm registry (verified 2025-05-25)
