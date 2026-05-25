---
phase: 03-real-time-container-status
verified: 2026-05-25T19:16:01Z
status: human_needed
score: 14/14
overrides_applied: 0
human_verification:
  - test: "Start a container from CLI and observe badge"
    expected: "Container status badge updates to running in the browser within 2 seconds — no page refresh required"
    why_human: "End-to-end timing requires a live Docker host, running SSH session, and a browser — cannot be verified with static analysis"
  - test: "Stop a container from CLI and observe badge"
    expected: "Container status badge flips to stopped in the browser within 2 seconds — no page refresh required"
    why_human: "Same as above — requires live runtime environment with Docker CLI access"
---

# Phase 3: Real-Time Container Status — Verification Report

**Phase Goal:** The container list reflects live Docker state without any manual refresh
**Verified:** 2026-05-25T19:16:01Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All 14 code-verifiable truths VERIFIED. Two ROADMAP success criteria require runtime testing (see [Human Verification Required](#human-verification-required)).

#### Backend Plan Truths (03-PLAN-backend-ws.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| B1 | One global SSH exec (`docker events`) open per server process — not per WS client | ✓ VERIFIED | `eventsManager` is a module-level singleton; `addClient` only calls `startStream()` when `!this.isRunning`; `removeClient` never stops the stream (line 37–40) |
| B2 | Matching container events (start/stop/die/kill/restart/pause/unpause/create/destroy) trigger `listContainers` SSH exec + broadcast to all WS clients | ✓ VERIFIED | `WATCHED_ACTIONS = new Set([...9 actions...])` (lines 9–11); `handleLine` → debounce → `broadcastUpdate()` → `listContainers(this.session)` → `ws.send(payload)` (lines 98–123) |
| B3 | GET /api/containers/events returns 401 when no valid sd_token cookie is present | ✓ VERIFIED | Route options `{ websocket: true, preHandler: [verifyAuth] }` (container-events.ts:19) AND global `fastify.addHook('preHandler', verifyAuth)` (server.ts:35) — double-protected |
| B4 | GET /api/containers/events upgrades to WebSocket when a valid sd_token cookie is present | ✓ VERIFIED | Route registered with `{ websocket: true }` (container-events.ts:19); `@fastify/websocket` registered first in server.ts (line 31) |
| B5 | New WS client immediately receives the current container list upon connect | ✓ VERIFIED | `addClient` calls `void this.sendCurrentList(ws)` (line 29); `sendCurrentList` executes `listContainers` and sends with `readyState === 1` guard (lines 126–134) |
| B6 | SSH disconnect triggers exponential-backoff reconnect (1s→2s→4s→…→30s max) | ✓ VERIFIED | `scheduleReconnect`: `fireAfter = this.retryDelay` captured before doubling, `this.retryDelay = Math.min(this.retryDelay * 2, BACKOFF_MAX_MS)`, `setTimeout(() => { this.startStream() }, fireAfter)` (lines 90–95); `BACKOFF_INITIAL_MS=1_000`, `BACKOFF_MAX_MS=30_000` |
| B7 | 150ms debounce coalesces rapid consecutive events into one listContainers call | ✓ VERIFIED | `DEBOUNCE_MS = 150` (line 8); `handleLine` clears existing timer and sets new 150ms timeout before `broadcastUpdate()` (lines 107–108) |

#### Frontend Plan Truths (03-PLAN-frontend-ws.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| F1 | DashboardPage opens a WebSocket to /api/containers/events on mount | ✓ VERIFIED | `useContainerEvents(queryClient)` called in DashboardPage (line 87); hook's `useEffect` calls `connect()` → `new WebSocket(wsUrl)` with URL `/api/containers/events` (useContainerEvents.ts:38–39) |
| F2 | Each WS message updates TanStack Query cache via `queryClient.setQueryData(['containers'], data)` | ✓ VERIFIED | `ws.onmessage` handler parses JSON, checks `msg.type === 'containers'`, then calls `queryClient.setQueryData(['containers'], msg.data)` (useContainerEvents.ts:53–54) |
| F3 | `refetchInterval` is `false` while WS is connected; re-enables at `5000ms` when WS disconnects | ✓ VERIFIED | `refetchInterval: wsConnected ? false : 5000` in DashboardPage useQuery call (line 99) |
| F4 | WS disconnect triggers reconnect with exponential backoff (1s→2s→4s→…→30s max) | ✓ VERIFIED | `ws.onclose` handler: `delay = retryDelayRef.current`, `retryDelayRef.current = Math.min(delay * 2, BACKOFF_MAX_MS)`, `setTimeout(connect, delay)` (useContainerEvents.ts:59–65) |
| F5 | A "reconnecting…" indicator is visible in the header when WS is disconnected (and not the first load) | ✓ VERIFIED | `{!wsConnected && hasConnectedOnce && <span className="...text-yellow-400...">reconnecting…</span>}` (DashboardPage.tsx:167–171); `hasConnectedOnce.current` set to `true` only in `ws.onopen` |
| F6 | WS connection is cleaned up on component unmount (WebSocket.close() called) | ✓ VERIFIED | Cleanup function: `cancelled = true; clearTimeout(reconnectTimerRef.current); wsRef.current.close(); setWsConnected(false)` (useContainerEvents.ts:77–82) |

#### ROADMAP Success Criteria (Phase 3)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Starting a container from CLI causes status badge to update within 2 seconds | ? UNCERTAIN | Code path is complete: Docker event → debounce 150ms → listContainers SSH exec → WS broadcast → setQueryData → React re-render. Actual timing requires live runtime test. |
| SC2 | Stopping a container from CLI causes badge to flip to stopped within 2 seconds | ? UNCERTAIN | Same code path as SC1. Requires live runtime test. |
| SC3 | One Docker events stream is open globally (no per-client streams accumulating) | ✓ VERIFIED | Singleton pattern enforced: `addClient` checks `!this.isRunning` before calling `startStream()` (lines 30–33); stream is never restarted on additional client connects |

**Score:** 14/14 code-verifiable truths VERIFIED (2 require human/runtime testing per ROADMAP SCs)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/services/docker-events.ts` | DockerEventsManager singleton — SSH exec stream, Set<WebSocket> broadcast, backoff reconnect | ✓ VERIFIED | 138 lines; exports `eventsManager`; all required features present |
| `packages/server/src/routes/container-events.ts` | WS route GET /api/containers/events — adds/removes clients from eventsManager | ✓ VERIFIED | 28 lines; exports `containerEventsRoute`; delegates to eventsManager |
| `packages/server/src/server.ts` | Registers @fastify/websocket before all routes; registers containerEventsRoute | ✓ VERIFIED | websocket registered at line 31 (first, before auth); containerEventsRoute at line 39 (last route) |
| `packages/web/src/hooks/useContainerEvents.ts` | useContainerEvents(queryClient) hook — WS lifecycle, backoff reconnect, cache injection | ✓ VERIFIED | 87 lines; exports `useContainerEvents`; returns `{ wsConnected, hasConnectedOnce }` |
| `packages/web/src/pages/DashboardPage.tsx` | Dashboard integrating useContainerEvents with dynamic refetchInterval and reconnect indicator | ✓ VERIFIED | Hook called at line 87; refetchInterval dynamic at line 99; reconnecting… indicator at lines 167–171 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `container-events.ts` | `docker-events.ts` | `eventsManager.addClient(socket, session)` / `eventsManager.removeClient(socket)` | ✓ WIRED | Lines 22, 24 |
| `docker-events.ts` | `docker-ssh.ts` | `listContainers(this.session)` on each matching event | ✓ WIRED | Lines 115, 129; `docker-ssh.ts` executes `docker ps -a` via SSH exec |
| `server.ts` | `container-events.ts` | `await fastify.register(containerEventsRoute)` | ✓ WIRED | Line 39; after websocket (line 31) and auth routes (lines 37–38) |
| `DashboardPage.tsx` | `useContainerEvents.ts` | `const { wsConnected, hasConnectedOnce } = useContainerEvents(queryClient)` | ✓ WIRED | Line 87 |
| `useContainerEvents.ts` | `/api/containers/events` | `new WebSocket(wsUrl)` — native browser WebSocket API | ✓ WIRED | Line 39; URL derived from `window.location.host` |
| `useContainerEvents.ts` | `queryClient` | `queryClient.setQueryData(['containers'], msg.data)` on each message | ✓ WIRED | Line 54 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `docker-events.ts` → `broadcastUpdate` | `containers` | `listContainers(this.session)` → `sshExec(session, "docker ps -a ...")` → SSH exec result parsed as JSON | Yes — live `docker ps -a` output from remote SSH host | ✓ FLOWING |
| `docker-events.ts` → `sendCurrentList` | `containers` | Same as above | Yes | ✓ FLOWING |
| `useContainerEvents.ts` → `ws.onmessage` | `msg.data` (ContainerInfo[]) | WS message from server's `broadcastUpdate` payload | Yes — server sends real `listContainers` result | ✓ FLOWING |
| `DashboardPage.tsx` | `containers` (from useQuery) | `queryClient` cache seeded by `setQueryData(['containers'], msg.data)` | Yes — WS-pushed real data | ✓ FLOWING |

---

### TypeScript Compilation

| Package | Command | Result | Status |
|---------|---------|--------|--------|
| `packages/server` | `npx tsc --noEmit` | exit 0, no errors | ✓ PASS |
| `packages/web` | `npx tsc --noEmit` | exit 0, no errors | ✓ PASS |

---

### Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `@fastify/websocket` installed | `grep "@fastify/websocket" packages/server/package.json` | `"@fastify/websocket": "^11.2.0"` | ✓ PASS |
| `@types/ws` installed | `grep "@types/ws" packages/server/package.json` | `"@types/ws": "^8.18.1"` | ✓ PASS |
| All 9 WATCHED_ACTIONS present | `grep "WATCHED_ACTIONS" docker-events.ts` | start, stop, die, kill, restart, pause, unpause, create, destroy | ✓ PASS |
| `websocket` registered FIRST in server.ts | Line order check | `register(websocket)` at line 31, before `registerAuthPlugins` at line 33 | ✓ PASS |
| `containerEventsRoute` registered LAST among routes | Line order check | Line 39, after `authRoutes` (37) and `containerRoutes` (38) | ✓ PASS |
| No bare `ws.send()` without readyState guard | `grep "ws.send"` + context | All `ws.send()` calls guarded by `ws.readyState === 1` (lines 119, 130) | ✓ PASS |
| `hasConnectedOnce` ref prevents false reconnecting… on initial load | Code trace | `hasConnectedOnce.current` starts `false`; set `true` only in `ws.onopen`; DashboardPage renders indicator only when `!wsConnected && hasConnectedOnce` | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CONT-03 | 03-PLAN-backend-ws.md, 03-PLAN-frontend-ws.md | Real-time container status updates | ✓ SATISFIED | Complete push pipeline: SSH `docker events` stream → debounce → broadcast → WS → setQueryData → React render |

---

### Anti-Patterns Found

No anti-patterns found. Scanned all 5 modified files for: `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, `PLACEHOLDER`, empty returns, hardcoded stubs. All clear.

---

### Human Verification Required

#### 1. Badge update on container start (ROADMAP SC1)

**Test:** On a host with Docker running, start the dev server and open the browser. Run `docker start <stopped-container-name>` from the CLI.
**Expected:** The container's status badge changes from stopped to running in the browser within 2 seconds, without any page refresh or manual action.
**Why human:** Requires a live Docker host accessible via SSH, a running Fastify server, and a connected browser. The timing constraint (<2 seconds) cannot be verified by static analysis.

#### 2. Badge update on container stop (ROADMAP SC2)

**Test:** With the app open in the browser, run `docker stop <running-container-name>` from the CLI.
**Expected:** The container's status badge flips to stopped in the browser within 2 seconds, without any page refresh.
**Why human:** Same constraints as SC1. The full event path (Docker event → SSH stream → 150ms debounce → listContainers → WS broadcast → React re-render) produces the right sequence in code but timing under real network latency requires live observation.

---

### Gaps Summary

No gaps. All code-verifiable truths are satisfied. Both automated TypeScript checks pass cleanly. The only open items are the two ROADMAP success criteria requiring live Docker runtime (SC1 and SC2) — these are behavioral tests, not code deficiencies.

The implementation is structurally complete and correctly wired end-to-end.

---

_Verified: 2026-05-25T19:16:01Z_
_Verifier: the agent (gsd-verifier)_
