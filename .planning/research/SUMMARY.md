# Project Research Summary

**Project:** ServerDeck — Mobile-Friendly Personal Server Dashboard
**Domain:** Self-hosted server management tool (Docker monitoring + web SSH terminal)
**Researched:** 2025-05-25
**Confidence:** HIGH (all core libraries verified via Context7 + npm registry + OWASP)

---

## Executive Summary

ServerDeck is a single-user self-hosted dashboard that belongs to a well-understood category (server management tools) with clear reference implementations: Portainer, Dockge, Lazydocker, Cockpit, and ttyd. The recommended approach is a **single Node.js process** (Fastify 5 backend) that serves both the REST API and the compiled React SPA, with WebSocket channels multiplexed over the same connection for real-time container events, log streaming, and SSH terminal I/O. This avoids the operational complexity of multiple processes while covering all required features cleanly. The stack is modern but settled: every core library has been verified at a specific version with active maintenance.

The dominant risk in this domain is **security, not implementation complexity**. The Docker UNIX socket is equivalent to unrestricted root access — any code path that reaches it without authentication is a full host-compromise vector. WebSocket upgrade handlers are the most commonly missed auth checkpoint (they sit outside normal HTTP middleware chains). The second class of risk is **resource leaks**: Docker log streams and SSH connections do not self-terminate when clients disconnect; explicit cleanup in disconnect handlers is mandatory. Both risks are well-understood and fully preventable with specific patterns documented in the research.

The recommended build order is auth-first → Docker REST → real-time status events → log streaming → SSH terminal → mobile polish. This order is non-negotiable: auth is a prerequisite for every other phase, and the event-driven container status pattern must be established before log streaming is added (they share Socket.IO/WebSocket infrastructure). SSH terminal is largely independent of Docker features and can be built in parallel once auth is solid, but is placed after Docker work because the terminal component (xterm.js + WebSocket + ssh2) carries the highest mobile-specific UX debt and benefits from lessons learned in earlier phases.

---

## Key Findings

### Recommended Stack

→ See full detail: [STACK.md](./STACK.md)

The backend is **Fastify 5** (not Express, not Hono): its plugin architecture maps directly to the features needed (WebSocket, JWT, static serving each have official `@fastify/*` plugins), and `@fastify/websocket` applies auth hooks before the WebSocket upgrade — solving the most critical security pitfall automatically. Docker access uses **dockerode** (the de facto standard Node.js Docker client, pure-JS, 5+ years production use). SSH uses **ssh2** (pure-JS over `node-pty` which requires native compilation and breaks in Docker/after Node upgrades). The frontend is **React 19 + Vite 8 + Tailwind v4 + shadcn/ui** with **xterm.js 5.x** for the terminal component.

> ⚠️ **Stack vs Architecture file discrepancy:** ARCHITECTURE.md was written with Express + Socket.IO in mind; STACK.md (higher verification quality) recommends Fastify + `@fastify/websocket`. **The STACK.md recommendation takes precedence.** Socket.IO's auto-reconnect benefit is outweighed by the extra dependency; Fastify's WebSocket plugin handles auth hooks more cleanly. The architecture diagrams in ARCHITECTURE.md are structurally valid — only the specific framework names differ.

**Core technologies:**

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| HTTP server | Fastify | `^5.8.5` | Plugin ecosystem, TypeScript-native, auth hooks before WS upgrade |
| WebSocket | @fastify/websocket | `^11.2.0` | Per-route WS with full Fastify lifecycle (auth runs before upgrade) |
| Auth | @fastify/jwt + @fastify/cookie | `^10.1.0` / `^11.0.2` | httpOnly cookie JWT — survives refresh, immune to XSS |
| Docker API | dockerode | `^5.0.0` | Standard Node.js Docker client, event streams, log demux |
| SSH | ssh2 | `^1.17.0` | Pure-JS PTY-backed shell, no native compilation required |
| Password | bcryptjs | `^3.0.3` | Pure-JS bcrypt, timing-safe compare |
| UI framework | React + Vite | `^19.2.6` / `^8.0.14` | Best xterm.js + shadcn/ui + TanStack Query integration |
| Styling | Tailwind v4 + shadcn/ui | `^4.3.0` | Mobile-first, 44px touch targets, Radix accessibility |
| Terminal | @xterm/xterm + addons | `^5.6.0` | Powers VS Code terminal; handles ANSI, touch, resize |
| Server state | TanStack Query | `^5.100.14` | Polling + optimistic updates for container actions |
| UI state | Zustand | `^5.0.13` | 1KB, holds active session/selected container state |

### Expected Features

→ See full detail: [FEATURES.md](./FEATURES.md)

**Must have (v1 table stakes):**
- **Auth** — username + password login, session persistence via httpOnly JWT cookie, logout
- **Container list** — live status (running/stopped/exited), color-coded badges, polled via Docker events stream
- **Container actions** — start, stop, restart with confirmation guard
- **Live log streaming** — WebSocket-based tailing, auto-scroll with pause, `tail: 200` initial fetch
- **SSH terminal** — xterm.js + WebSocket + ssh2 PTY to server localhost
- **Virtual keyboard toolbar** — Ctrl, Alt, Tab, Esc, arrow keys above terminal (the #1 mobile terminal gap)
- **Mobile layout** — bottom nav bar, ≥44px tap targets, `dvh` viewport units, debounced terminal resize

**Should have (v2 differentiators):**
- Container exec shell (reuses terminal plumbing — add after SSH terminal is validated)
- Container resource stats — CPU/mem % via Docker stats API stream
- Log search/filter — client-side against buffered lines
- Auto-reconnect for log and terminal WebSockets (exponential backoff)
- PWA manifest — add-to-home-screen, no offline needed
- Container detail view — env vars (read-only), ports, image, created time

**Never build (confirmed anti-features):**
- Multi-user / RBAC, multi-server, Docker image management, Compose UI, plugin system, notifications/alerting, 2FA, theme toggle, audit log

### Architecture Approach

→ See full detail: [ARCHITECTURE.md](./ARCHITECTURE.md)

One Node.js process handles everything: Fastify serves the React SPA as static files from `dist/`, provides REST endpoints for auth and container actions, and upgrades specific routes to WebSocket channels for real-time data. Three logical channels run over WebSocket: (1) container events broadcast to all connected clients, (2) per-container log streams subscribed on demand, (3) bidirectional SSH terminal I/O. The Docker Service and SSH Service are the only components that touch system resources (Docker socket, sshd) — all other components route through them.

**Major components:**

| Component | Responsibility |
|-----------|---------------|
| **Fastify HTTP Server** | REST endpoints, static SPA serving, auth middleware, WS route handlers |
| **Auth Module** | bcryptjs login verify, JWT sign/verify, cookie set, route guard hook |
| **Docker Service** | dockerode singleton — list containers, start/stop/restart, log streams, events stream |
| **SSH Service** | ssh2 Client factory — one Client per terminal session, PTY lifecycle, stream bridge |
| **React SPA** | Auth flow, container dashboard, log viewer, xterm.js terminal, Zustand/TanStack Query state |

**Key architectural rules:**
1. One global Docker events stream (opened at startup) — never per-client
2. All WebSocket channels share one underlying connection (browser handles one WS well on mobile)
3. Explicit cleanup for every log stream and SSH session on `socket.on('disconnect')`
4. Auth verified before any WebSocket upgrade is accepted (Fastify handles this with `onRequest` hook)

### Critical Pitfalls

→ See full detail (20 pitfalls documented): [PITFALLS.md](./PITFALLS.md)

**Top 7 — all must be addressed before shipping:**

1. **Docker socket = unrestricted root** — Auth check before *every* dockerode call, including WebSocket upgrade handlers. `@fastify/websocket` solves this via `onRequest` hooks if wired correctly.

2. **WebSocket endpoints not authenticated** — The WS upgrade happens at the HTTP layer. With raw `ws`, auth is commonly missed. Use `@fastify/websocket`'s per-route auth hooks to ensure the JWT is verified before the upgrade completes.

3. **Log stream memory leak** — `container.logs({ follow: true })` never self-terminates. Must call `logStream.destroy()` in the WebSocket `close` handler. Missing this = file descriptor leak proportional to container views.

4. **SSH session not closed on disconnect** — `ssh2 Client` requires explicit `conn.end()`. Wire cleanup in `ws.on('close')` and `ws.on('error')`. Zombie SSH sessions accumulate until PAM limits are hit.

5. **Docker event stream opened per-client** — `docker.getEvents()` must be opened **once** globally at startup and broadcast to clients. Opening it per WebSocket connection creates compounding listener accumulation.

6. **Session token in WebSocket URL** — `?token=xyz` query params appear in server logs and browser history. Use httpOnly cookies (sent automatically on WS upgrade) or validate JWT in the first WS message.

7. **Docker log stream multiplexing** — Non-TTY containers use a framed binary protocol (8-byte header per chunk). Piping raw to WebSocket sends binary garbage to the client. Always call `container.modem.demuxStream()` after inspecting `Config.Tty`.

**Top mobile-specific pitfalls (addressed in Phase 6):**
- iOS `100vh` bug — use `dvh` units + debounce resize handler (100ms)
- Autocorrect corrupts terminal input — verify xterm.js textarea has `autocorrect="off"` on real iOS device
- `fitAddon.fit()` before DOM layout — wrap in `requestAnimationFrame`
- `terminal.dispose()` not called on unmount — WebGL context exhaustion on iOS after ~8 terminal opens

---

## Implications for Roadmap

Based on combined research, the following **6-phase structure** is recommended. This order is derived from the dependency graph in FEATURES.md, the build order in ARCHITECTURE.md, and the phase-specific pitfall warnings in PITFALLS.md.

---

### Phase 1: Auth Foundation
**Rationale:** Security prerequisite — no other phase is safe to ship without auth gating Docker and SSH access. The Docker socket = root equivalence makes this non-negotiable as Phase 1.  
**Delivers:** Login page, JWT-based session, logout, protected route pattern  
**Addresses:** "User can log in", "Session persists across refresh"  
**Stack elements:** Fastify, @fastify/jwt, @fastify/cookie, bcryptjs, React login page, dotenv  
**Pitfalls to prevent:** Rate-limit login endpoint (P15), httpOnly cookie not token-in-URL (P6), HTTPS startup warning (P20)  
**Research flag:** Standard patterns — skip research phase

---

### Phase 2: Container Dashboard (REST)
**Rationale:** Validate Docker socket access and core CRUD before adding real-time complexity. Isolating the HTTP layer first makes debugging straightforward.  
**Delivers:** Container list (static snapshot on load), start/stop/restart actions with confirmation  
**Addresses:** "User can see container list", "User can start/stop/restart"  
**Stack elements:** dockerode, Fastify REST routes, TanStack Query, shadcn/ui Card + Badge  
**Pitfalls to prevent:** Full container IDs internally / truncated in UI (P17), auth on every dockerode call (P1)  
**Research flag:** Standard patterns — skip research phase

---

### Phase 3: Real-Time Container Status
**Rationale:** Upgrades Phase 2's static list to event-driven live updates. Must be established before log streaming (they share WebSocket infrastructure).  
**Delivers:** Live container status updates via Docker events stream over WebSocket  
**Addresses:** "Live status" requirement, removes polling race conditions  
**Stack elements:** @fastify/websocket, dockerode `getEvents()`, TanStack Query invalidation  
**Pitfalls to prevent:** One global events stream, not per-client (P5); async state update race after actions (P18)  
**Research flag:** Standard patterns — skip research phase

---

### Phase 4: Log Streaming
**Rationale:** Depends on Phase 3's WebSocket infrastructure. Log streaming is the second most common operation and completes the "observe" side of the dashboard.  
**Delivers:** Live log tailing for any container via WebSocket, auto-scroll with pause  
**Addresses:** "User can view live logs"  
**Stack elements:** dockerode `container.logs({ follow: true })`, WebSocket, xterm.js (or styled `<pre>`)  
**Pitfalls to prevent:** Log stream leak on disconnect (P4), multiplexed stream demux (P7), tail limit on initial fetch (P12), ANSI codes rendering (P19)  
**Research flag:** Standard patterns — but implement demux carefully (P7 is easy to miss)

---

### Phase 5: SSH Terminal
**Rationale:** Architecturally independent of Docker features (only requires auth from Phase 1). Placed here because the xterm.js component carries the most mobile UX complexity; earlier phases build intuition about the mobile layout before tackling the terminal.  
**Delivers:** Full PTY-backed SSH terminal to the server, accessible from mobile browser  
**Addresses:** "User can open web-based SSH terminal" + virtual keyboard toolbar  
**Stack elements:** ssh2, @fastify/websocket /terminal route, @xterm/xterm, @xterm/addon-attach, @xterm/addon-fit  
**Pitfalls to prevent:** SSH cleanup on disconnect (P3), PTY resize propagation (P8), terminal dispose on unmount (P16), SSH keepalive (P14)  
**Research flag:** ⚑ Recommend `--research-phase` — xterm.js + ssh2 WebSocket wiring has several non-obvious integration points (PTY size, resize events, credential handling); the research is done but implementation is nuanced

---

### Phase 6: Mobile Polish + Hardening
**Rationale:** Mobile UX issues (iOS viewport, autocorrect, touch targets) are best addressed as a dedicated pass after all features work on desktop. Security hardening (rate limiting verification, error sanitization) fits here too.  
**Delivers:** Production-ready mobile experience, deployment documentation, error boundaries  
**Addresses:** "UI is mobile-first and usable on a phone screen"  
**Implements:** `dvh` viewport fix, debounced resize, virtual keyboard toolbar (if not in Phase 5), reconnect UX, PWA manifest (optional)  
**Pitfalls to prevent:** iOS `100vh` bug (P9), autocorrect corruption (P10), FitAddon pre-layout (P11), Docker error sanitization (P1 follow-up)  
**Research flag:** Standard patterns — skip research phase

---

### Phase Ordering Rationale

- **Auth first** — Docker socket is root-equivalent; shipping any Docker feature without auth is a critical vulnerability
- **REST before real-time** — validates dockerode connectivity and container model before adding WebSocket complexity
- **Events before logs** — both use WebSocket; establishing the events channel first creates the pattern for log streaming
- **SSH after Docker** — SSH terminal is architecturally independent, but xterm.js on mobile needs the full mobile layout established in Phases 2–4 to integrate cleanly
- **Polish last** — mobile UX issues are best fixed holistically once all features work

### Research Flags

**Phases needing deeper planning research:**
- **Phase 5 (SSH Terminal):** `--research-phase` recommended. The xterm.js ↔ WebSocket ↔ ssh2 chain has 4+ integration points that are non-obvious: PTY initial size, resize event propagation, bidirectional data framing, and mobile keyboard handling. Research is complete but implementation is genuinely complex.

**Phases with standard patterns (skip research):**
- **Phase 1 (Auth):** JWT + httpOnly cookie is a solved pattern. Fastify plugin docs are comprehensive.
- **Phase 2 (Container REST):** dockerode list/inspect/start/stop are well-documented. Standard CRUD.
- **Phase 3 (Real-Time Status):** Docker events stream + WebSocket broadcast is a known pattern.
- **Phase 4 (Log Streaming):** Standard except for the demux gotcha — well-documented in dockerode README.
- **Phase 6 (Polish):** CSS/UX work with known solutions for each issue.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | All packages verified via Context7 + npm registry at specific versions. Fastify vs Socket.IO discrepancy between ARCHITECTURE.md and STACK.md resolved in favor of STACK.md (more recently verified). |
| Features | **HIGH** | Cross-referenced against 6 reference applications (Portainer, Dockge, Lazydocker, Yacht, Homarr, Cockpit). Table stakes are unambiguous. |
| Architecture | **HIGH** | Patterns verified against official dockerode, ssh2, xterm.js docs. Component boundaries are clean. |
| Pitfalls | **HIGH** | Sourced from OWASP Docker + Node.js security cheat sheets + official library READMEs. 20 pitfalls documented with code-level prevention. |

**Overall confidence: HIGH**

### Gaps to Address

1. **Express vs Fastify in ARCHITECTURE.md diagrams** — ARCHITECTURE.md code examples reference `express-rate-limit` and Express-style `app.use()`. During implementation, these should be translated to Fastify equivalents (`@fastify/rate-limit`, Fastify hooks). The structural patterns (service boundaries, data flow) remain valid.

2. **Socket.IO vs raw WebSocket** — ARCHITECTURE.md assumes Socket.IO's auto-reconnect. STACK.md uses `@fastify/websocket` (raw WebSocket). The decision to use raw WebSocket means **reconnect logic must be implemented manually** in the React client. This is moderate complexity and should be explicitly planned in Phase 6.

3. **SSH credential approach** — Research recommends using the server's own SSH key (`SSH_KEY_PATH` env var). The exact key path, permissions, and setup instructions need to be documented in deployment docs. Validate that the Node.js process user has read access to the key at startup.

4. **Container exec shell (v2)** — Architecturally reuses the SSH terminal WebSocket pattern but connects to `docker exec` instead of `ssh2`. Not in v1 scope but clean to add if the xterm.js component is built generically.

5. **Mobile testing** — Several pitfalls (P9 iOS viewport, P10 autocorrect) require testing on a real iOS device. Emulators do not reproduce these behaviors. Plan for real-device testing in Phase 5 and 6.

---

## Sources

### Primary (HIGH confidence — verified)
- `context7:/apocas/dockerode` — container lifecycle, log streams, events stream, demux
- `context7:/mscdex/ssh2` — PTY shell, keepalive, connection lifecycle
- `context7:/xtermjs/xterm.js` — FitAddon, AttachAddon, mobile input, dispose
- `context7:/fastify/fastify` — v5.8.5, WebSocket plugin, JWT plugin, hooks
- `context7:/shadcn-ui/ui` — Tailwind v4 + Vite installation (apps/v4 docs)
- npm registry — all package versions verified 2025-05-25
- OWASP Docker Security Cheat Sheet — Docker socket risks, auth patterns
- OWASP Node.js Security Cheat Sheet — rate limiting, session security

### Secondary (HIGH confidence — official READMEs)
- Dockge GitHub — feature patterns for container management
- Lazydocker GitHub — feature set reference
- Yacht GitHub — mobile-friendly dashboard patterns
- Homarr GitHub — dashboard UX patterns
- Cockpit Project — server management feature benchmark
- ttyd GitHub — production xterm.js + WebSocket reference implementation

---
*Research completed: 2025-05-25*  
*Ready for roadmap: yes*
