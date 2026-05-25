---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planned
last_updated: "2026-05-25T12:29:32.570Z"
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 17
---

# ServerDeck — Project State

**Project:** ServerDeck  
**Core Value:** From any phone browser, see what's running on your server and drop into a shell — no apps, no VPN setup, no switching tools.  
**Last Updated:** 2026-05-25

---

## Current Position

| Field | Value |
|-------|-------|
| **Phase** | 1 — Auth Foundation |
| **Plan** | Ready for execution (3 plans, 3 waves) |
| **Status** | Planned — awaiting `/gsd-execute-phase 1` |
| **Milestone** | v1 |

**Progress:**

[░░░░░░░░░░] 0%
[░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0% — 0 of 6 phases complete (Phase 1 planned)

```

---

## Phase Summary

| Phase | Name | Status |
|-------|------|--------|
| 1 | Auth Foundation | **Planned** (3 plans ready) |
| 2 | Container Dashboard | Not started |
| 3 | Real-Time Container Status | Not started |
| 4 | Log Streaming | Not started |
| 5 | SSH Terminal | Not started |
| 6 | Mobile Polish + Hardening | Not started |

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases defined | 6 |
| Requirements mapped | 27/27 |
| Plans created | 3 |
| Plans complete | 0 |
| Phases complete | 0 |

---

## Accumulated Context

### Key Decisions Locked In

- **Stack**: Fastify 5 + React 19 + Vite 8 + Tailwind v4 + shadcn/ui (STACK.md takes precedence over ARCHITECTURE.md which referenced Express/Socket.IO)
- **Auth**: httpOnly JWT cookie via `@fastify/jwt` + `@fastify/cookie` — never token-in-URL, never localStorage
- **Docker client**: `dockerode ^5.0.0` — one global `getEvents()` stream at startup, broadcast to all clients
- **SSH**: `ssh2 ^1.17.0` pure-JS — no `node-pty` (breaks in Docker after Node upgrades)
- **Terminal**: `@xterm/xterm ^5.6.0` + `@xterm/addon-fit` + `@xterm/addon-attach`
- **WebSocket**: `@fastify/websocket ^11.2.0` — auth hooks run before upgrade, solving the most critical WS auth pitfall
- **Rate limiting**: `@fastify/rate-limit` on login endpoint (brute-force protection, AUTH-05)

### Critical Pitfalls to Keep in Mind

1. **Docker socket = root** — auth check before every dockerode call including WS upgrade handlers
2. **WebSocket auth gap** — `@fastify/websocket` `onRequest` hooks must be wired on every WS route
3. **Log stream leak** — `logStream.destroy()` must fire in the WS `close` handler
4. **SSH zombie sessions** — `conn.end()` must fire in `ws.on('close')` and `ws.on('error')`
5. **One global events stream** — `docker.getEvents()` opened once at startup, never per-client
6. **Docker log demux** — Non-TTY containers use 8-byte framed protocol; call `container.modem.demuxStream()` after inspecting `Config.Tty`
7. **iOS terminal viewport** — use `dvh` units + 100 ms debounce on resize; test on real iOS device
8. **FitAddon timing** — wrap `fitAddon.fit()` in `requestAnimationFrame` to avoid pre-layout call
9. **Terminal dispose** — call `terminal.dispose()` on unmount to prevent WebGL context exhaustion on iOS

### Research Notes

- Phase 5 (SSH Terminal) flagged for careful implementation — xterm.js ↔ WebSocket ↔ ssh2 chain has 4+ non-obvious integration points (PTY initial size, resize propagation, bidirectional framing, mobile keyboard). Research is complete in `.planning/research/`.
- Mobile pitfalls (iOS `100vh` bug, autocorrect) require real-device testing — emulators do not reproduce them.
- Manual WebSocket reconnect logic needed (raw `@fastify/websocket`, not Socket.IO) — planned for Phase 6.

### Architecture Constraints

- Single Node.js process: Fastify serves React SPA (`dist/`), REST endpoints, and WebSocket channels
- No external database — state lives in memory + Docker socket
- SSH connects to `localhost` using server's own key (path via `SSH_KEY_PATH` env var)
- All Docker and SSH operations require authenticated session (enforced at route level)

---

## Todos

- [x] Plan Phase 1 (Auth Foundation) — 3 plans committed, plan-checker PASS
- [ ] Execute Phase 1 (`/gsd-execute-phase 1`)
- [ ] Scaffold project (Wave 1: pnpm monorepo + Fastify 5 + React/Vite/Tailwind v4/shadcn/ui)
- [ ] Confirm SSH key path and permissions at startup

---

## Blockers

None.

---

## Session Continuity

To resume work on this project:

1. Read `.planning/ROADMAP.md` → identify current phase
2. Read `.planning/STATE.md` → this file, for context and decisions
3. Run `/gsd-plan-phase N` to create a plan for the next phase
4. Run `/gsd-execute` to execute the current plan

---
*State initialized: 2026-05-25 after roadmap creation*
