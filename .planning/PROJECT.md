# ServerDeck

## What This Is

ServerDeck is a mobile-friendly personal server dashboard that gives you a real-time view of all Docker containers running on your server and a direct SSH terminal in the browser. It's built for a single user who wants to monitor and manage their server from their phone without needing a separate SSH app.

## Core Value

From any phone browser, see what's running on your server and drop into a shell — no apps, no VPN setup, no switching tools.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can log in with username and password
- [ ] User can see a list of all Docker containers with live status (running/stopped/exited)
- [ ] User can start, stop, and restart any container
- [ ] User can view live logs for any container
- [ ] User can open a web-based SSH terminal to the server
- [ ] The UI is mobile-first and usable on a phone screen
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
| Username + password auth | Simplest approach for single-user personal tool; works great on mobile | — Pending |
| Web app (not native mobile) | No app store, instant access from any phone browser | — Pending |
| Node.js backend | Natural fit for SSH (ssh2 library) and Docker (dockerode), single runtime | — Pending |
| React frontend (mobile-first) | Tailwind CSS for responsive design, xterm.js for terminal | — Pending |
| App runs on the server | Reduces latency, Docker socket access is local | — Pending |

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
*Last updated: 2026-05-25 after initialization*
