# ServerDeck

## What This Is

ServerDeck is a mobile-friendly personal server dashboard that gives you a real-time view of all Docker containers running on your server and a direct SSH terminal in the browser. It's built for a single user who wants to monitor and manage their server from their phone without needing a separate SSH app.

## Core Value

From any phone browser, see what's running on your server and drop into a shell — no apps, no VPN setup, no switching tools.

## Current Milestone: v1.1 Complete the Vision

**Goal:** Ship the full original product vision — an interactive SSH terminal and a production-ready mobile experience.

**Target features:**
- SSH Terminal — PTY-backed shell accessible from any phone browser via WebSocket
- Mobile Polish + PWA — 390px-optimised layout, iOS keyboard handling, installable via home screen

## Requirements

### Validated

- [x] User can log in with username and password (Phase 1 — Auth Foundation)
- [x] User can see a list of all Docker containers with live status (Phase 2 — Container Dashboard)
- [x] User can start, stop, and restart any container (Phase 2 — Container Dashboard)
- [x] Container list updates live without a page reload (Phase 3 — Real-Time Status)
- [x] User can view live logs for any container (Phase 4 — Log Streaming)

### Active

- [ ] User can open a web-based SSH terminal to the server (Phase 5)
- [ ] The UI is mobile-first and production-ready on a phone screen (Phase 6)
- [ ] App is installable as a PWA (Phase 6)
- [ ] Session persists across browser refresh

### Out of Scope

- Multi-server support — complexity not needed for personal use; single server is the target
- Docker image management (build/pull/push) — operations dashboard only, not image registry
- Docker Compose management UI — out of scope for v1; individual container control is sufficient
- Mobile native app — web app is sufficient, avoids app store distribution
- User management / multiple accounts — single-user tool

## Context

- This is a personal tool, self-hosted on the user's own server
- The app itself will run on the server (Node.js backend), accessed via browser (including mobile)
- Docker socket access is available on the server (standard for Docker management apps)
- SSH connection will be from the server process to itself (localhost) or to the same server
- Security matters: the app is internet-exposed so auth and session security are important
- Mobile-first: the UI must work well on small screens with touch interactions

## Constraints

- **Compatibility**: Must work in mobile Safari and Chrome on iOS/Android — no desktop-only dependencies
- **Deployment**: Single Node.js process on the server — no external services or databases needed
- **Security**: Protected by login; all Docker and SSH operations require authentication

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Username + password auth | Simplest approach for single-user personal tool; works great on mobile | ✅ Shipped Phase 1 |
| Web app (not native mobile) | No app store, instant access from any phone browser | ✅ Shipped Phase 1 |
| Node.js backend | Natural fit for SSH (ssh2 library) and Docker (dockerode), single runtime | ✅ Shipped Phase 1 |
| React frontend (mobile-first) | Tailwind CSS for responsive design, xterm.js for terminal | ✅ Shipped Phase 1 |
| App runs on the server | Reduces latency, Docker socket access is local | ✅ Shipped Phase 1 |
| @fastify/websocket for WS | Auth hooks run before upgrade, solving the critical WS auth gap | ✅ Shipped Phase 3 |
| ssh2 for SSH (no node-pty) | Pure-JS, survives Node upgrades inside Docker | ✅ Decided Phase 1 |
| @xterm/xterm for terminal | PTY rendering, fit addon for resize, attach addon for WS | In use Phase 5 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-26 — Milestone v1.1 started (phases 1–4 shipped)*
