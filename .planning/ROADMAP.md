# ServerDeck — Roadmap

**Project:** ServerDeck  
**Milestone:** v1.2 — Mobile Polish & PWA  
**Granularity:** Standard  
**Mode:** MVP (each phase delivers an end-to-end user-facing capability)  
**Coverage (v1.0):** 16/16 requirements mapped ✓ (shipped — Phases 1–4)  
**Coverage (v1.1):** 6/6 requirements mapped ✓ (shipped — Phase 5)  
**Coverage (v1.2):** 5/5 requirements mapped ✓ (active — Phase 6)  
**Created:** 2026-05-25  
**v1.1 started:** 2026-05-26  
**v1.2 started:** 2026-05-29

---

## Phases

- [x] **Phase 1: Auth Foundation** — Users can securely log in, maintain sessions, and log out; all routes are protected *(shipped v1.0)*
- [x] **Phase 2: Container Dashboard** — Users can see every Docker container and start, stop, or restart them *(shipped v1.0)*
- [x] **Phase 3: Real-Time Container Status** — Container list updates live without a page reload *(shipped v1.0)*
- [x] **Phase 4: Log Streaming** — Users can watch live container logs stream in the browser *(shipped v1.0)*
- [x] **Phase 5: SSH Terminal** — Users can open a full PTY-backed SSH terminal from a phone browser
- [ ] **Phase 6: Mobile Polish & PWA** — The app is fully usable on a 390px phone and installable as a PWA

---

## Phase Details

### Phase 1: Auth Foundation
**Goal**: Users can securely log in and out; every API route and WebSocket channel rejects unauthenticated access
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. User submits username + password on the login page and is redirected to the dashboard — no token visible in the URL or localStorage
  2. After a browser refresh, the user is still logged in (httpOnly cookie persists the session)
  3. User clicks "Log out" and is returned to the login page; a subsequent API call returns 401
  4. Submitting the wrong password 11+ times in 60 seconds is rejected with 429 Too Many Requests (rate limit: max 10/min per IP, per D-18)
  5. Accessing `/api/*` without a valid cookie returns 401 before any Docker code runs (WebSocket rejection verified in Phase 3 when WS routes are added)
**Plans**: 3 plans

Plans:
- [x] 01-PLAN-scaffold.md — Monorepo scaffold: pnpm workspaces, Fastify 5 skeleton, React/Vite/Tailwind v4/shadcn/ui
- [x] 01-PLAN-backend-auth.md — SSH auth service, session Map, JWT cookie endpoints, auth middleware
- [x] 01-PLAN-frontend-auth.md — Axios client, login page (UI-SPEC), ProtectedRoute, dashboard stub, Vite proxy

---

### Phase 2: Container Dashboard
**Goal**: Users can see all Docker containers with their current state and perform start/stop/restart actions
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CONT-01, CONT-02, CONT-04, CONT-05, CONT-06
**Success Criteria** (what must be TRUE):
  1. The dashboard lists every container on the host — running and stopped — each showing name, image, status badge, and uptime
  2. User clicks "Stop" on a running container; a confirmation guard appears; after confirming, the container stops and the badge changes to stopped
  3. User clicks "Start" on a stopped container; the container starts and the badge changes to running
  4. User clicks "Restart" on a running container; the container briefly stops then returns to running state
  5. All container actions require authentication — unauthenticated requests to action endpoints return 401
**Plans**: 2 plans

Plans:
- [x] 02-PLAN-docker-api.md — Docker SSH service, container list/action REST routes
- [x] 02-PLAN-container-ui.md — Container dashboard UI, TanStack Query, shadcn components
**UI hint**: yes

---

### Phase 3: Real-Time Container Status
**Goal**: The container list reflects live Docker state without any manual refresh
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CONT-03
**Success Criteria** (what must be TRUE):
  1. Starting a container from the CLI (outside the app) causes its status badge to update in the browser within 2 seconds — no page refresh required
  2. Stopping a container from the CLI causes its badge to flip to stopped in the browser within 2 seconds
  3. One Docker events stream is open globally (verified: no per-client streams accumulating on new connections)
**Plans**: 2 plans

Plans:
- [ ] 03-PLAN-backend-ws.md — Install @fastify/websocket, DockerEventsManager service (SSH events stream + broadcast), WS route GET /api/containers/events, server.ts registration
- [ ] 03-PLAN-frontend-ws.md — useContainerEvents hook (WS lifecycle, setQueryData, backoff reconnect), DashboardPage integration (dynamic refetchInterval, reconnecting indicator)

---

### Phase 4: Log Streaming
**Goal**: Users can open a live log view for any container and watch output stream in real time
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: LOGS-01, LOGS-02, LOGS-03, LOGS-04
**Success Criteria** (what must be TRUE):
  1. User taps a container row and opens its log view; the last ~200 lines of existing logs appear immediately
  2. New log lines written by the container appear in the browser within 1 second, auto-scrolling to the bottom
  3. ANSI colour codes in logs render as coloured text (not raw escape sequences)
  4. User closes the log view; the WebSocket and underlying Docker log stream are both terminated — no lingering file descriptors
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN-server-log-ws.md — WS route GET /api/containers/:id/logs + server.ts registration
- [x] 04-02-PLAN-frontend-log-view.md — ansi-to-html + useLogStream hook + LogPage + ContainerCard Logs button + App.tsx route
**UI hint**: yes

---

### Phase 5: SSH Terminal
**Goal**: Users can open a full interactive SSH terminal to the server from a mobile browser
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: SSH-01, SSH-02, SSH-03, SSH-04, SSH-05, SSH-06
**Success Criteria** (what must be TRUE):
  1. User taps "Terminal" and an xterm.js terminal opens, connected to a PTY shell on the server via SSH to localhost
  2. Typing commands in the terminal executes them on the server and output streams back in real time
  3. Resizing the browser window or triggering the iOS software keyboard causes the terminal to reflow correctly within 200 ms
  4. The touch toolbar above the terminal provides tappable Ctrl, Tab, Esc, and arrow key buttons that send the correct escape sequences
  5. Closing the terminal tab / navigating away terminates the SSH session on the server — no zombie processes accumulate
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN-backend-terminal.md — Backend WS route /api/terminal: ssh2 PTY proxy, verifyAuth, env var validation, stream.destroy() teardown
- [x] 05-02-PLAN-frontend-terminal.md — xterm.js packages, useTerminalSession hook, TouchToolbar component, TerminalPage, App.tsx route, DashboardPage Terminal button
**UI hint**: yes

---

### Phase 6: Mobile Polish & PWA
**Goal**: The app is fully usable on a 390px phone screen and installable as a PWA
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: MOBL-01, MOBL-02, MOBL-03, MOBL-04, MOBL-05
**Success Criteria** (what must be TRUE):
  1. User installs the app to the iOS home screen and it opens as a standalone PWA — no browser chrome, valid manifest with icons and `start_url`
  2. Opening the iOS software keyboard in the terminal does not shrink or obscure the xterm.js viewport — `dvh` units + debounced resize keep it correct
  3. All interactive elements (buttons, container rows, toolbar keys) have a minimum 44 × 44 px tap target — verified with browser DevTools
  4. The terminal input area has `autocorrect="off"` and `autocapitalize="off"` — iOS does not auto-correct shell commands
  5. Every screen (login, dashboard, log view, terminal) is fully usable on a 390px-wide display — no horizontal scroll, no clipped content
**Plans**: 1 plan

Plans:
- [ ] 06-PLAN.md — Infra fixes (static serving + auth scope), tap targets (MOBL-03), PWA install (MOBL-05)
**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Auth Foundation | 3/3 | ✅ Done | 2026-05-26 |
| 2. Container Dashboard | 2/2 | ✅ Done | 2026-05-26 |
| 3. Real-Time Container Status | 2/2 | ✅ Done | 2026-05-26 |
| 4. Log Streaming | 2/2 | ✅ Done | 2026-05-26 |
| 5. SSH Terminal | 2/2 | ✅ Done | 2026-05-26 |
| 6. Mobile Polish & PWA | 0/? | Not started | - |

---

## Coverage Map

| Requirement | Phase | Phase Name | Status |
|-------------|-------|------------|--------|
| AUTH-01 | Phase 1 | Auth Foundation | ✅ Shipped v1.0 |
| AUTH-02 | Phase 1 | Auth Foundation | ✅ Shipped v1.0 |
| AUTH-03 | Phase 1 | Auth Foundation | ✅ Shipped v1.0 |
| AUTH-04 | Phase 1 | Auth Foundation | ✅ Shipped v1.0 |
| AUTH-05 | Phase 1 | Auth Foundation | ✅ Shipped v1.0 |
| AUTH-06 | Phase 1 | Auth Foundation | ✅ Shipped v1.0 |
| CONT-01 | Phase 2 | Container Dashboard | ✅ Shipped v1.0 |
| CONT-02 | Phase 2 | Container Dashboard | ✅ Shipped v1.0 |
| CONT-03 | Phase 3 | Real-Time Container Status | ✅ Shipped v1.0 |
| CONT-04 | Phase 2 | Container Dashboard | ✅ Shipped v1.0 |
| CONT-05 | Phase 2 | Container Dashboard | ✅ Shipped v1.0 |
| CONT-06 | Phase 2 | Container Dashboard | ✅ Shipped v1.0 |
| LOGS-01 | Phase 4 | Log Streaming | ✅ Shipped v1.0 |
| LOGS-02 | Phase 4 | Log Streaming | ✅ Shipped v1.0 |
| LOGS-03 | Phase 4 | Log Streaming | ✅ Shipped v1.0 |
| LOGS-04 | Phase 4 | Log Streaming | ✅ Shipped v1.0 |
| SSH-01 | Phase 5 | SSH Terminal | ✅ Shipped v1.1 |
| SSH-02 | Phase 5 | SSH Terminal | ✅ Shipped v1.1 |
| SSH-03 | Phase 5 | SSH Terminal | ✅ Shipped v1.1 |
| SSH-04 | Phase 5 | SSH Terminal | ✅ Shipped v1.1 |
| SSH-05 | Phase 5 | SSH Terminal | ✅ Shipped v1.1 |
| SSH-06 | Phase 5 | SSH Terminal | ✅ Shipped v1.1 |
| MOBL-01 | Phase 6 | Mobile Polish & PWA | Pending |
| MOBL-02 | Phase 6 | Mobile Polish & PWA | Pending |
| MOBL-03 | Phase 6 | Mobile Polish & PWA | Pending |
| MOBL-04 | Phase 6 | Mobile Polish & PWA | Pending |
| MOBL-05 | Phase 6 | Mobile Polish & PWA | Pending |

**Total mapped: 27/27 ✓** (16 shipped in v1.0 + 6 shipped in v1.1 + 5 active in v1.2)

---
*Roadmap created: 2026-05-25*  
*v1.1 milestone started: 2026-05-26 — Phases 1–4 shipped*  
*v1.2 milestone started: 2026-05-29 — Phase 5 shipped*  
*Next: `/gsd-plan-phase 6`*
