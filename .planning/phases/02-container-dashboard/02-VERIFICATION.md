---
phase: 02-container-dashboard
verified: 2026-05-25T12:00:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Open dashboard; confirm every container shown with name, image, status badge, and uptime"
    expected: "All containers (running and stopped) visible; state badge correctly color-coded; 'Up N hours' / 'Exited (0) N days ago' text visible under each card"
    why_human: "docker ps -a output from a real SSH host required; badge color rendering cannot be verified by grep"
  - test: "Click Stop on a running container; verify confirmation dialog appears naming the container, then confirm"
    expected: "AlertDialog appears with container name; after clicking 'Stop container' the card badge changes from running (green) to exited (grey)"
    why_human: "Requires live Docker host; UI state transition after mutation is runtime behavior"
  - test: "Click Start on a stopped container; verify badge changes to running"
    expected: "Card badge changes to green 'running' within ~5 seconds (next refetch)"
    why_human: "Requires live Docker host to confirm state change"
  - test: "Click Restart on a running container; observe brief state change then return to running"
    expected: "Container briefly appears as 'restarting' (spinner button) then returns to green 'running'"
    why_human: "Real Docker restart cycle and polling timing cannot be verified statically"
---

# Phase 2: Container Dashboard — Verification Report

**Phase Goal:** Users can see all Docker containers with their current state and perform start/stop/restart actions.  
**Verified:** 2026-05-25T12:00:00Z  
**Status:** human_needed  
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Dashboard lists every container (running + stopped) with name, image, status badge, uptime | ✓ VERIFIED | `docker-ssh.ts` uses `docker ps -a` (all containers). `ContainerCard.tsx` renders `container.names[0]`, `container.image`, `StateBadge`, and `container.status` (human-readable uptime). `DashboardPage.tsx` maps full response array to `ContainerCard`. |
| 2 | Stop confirmation guard: AlertDialog appears before stop; badge changes to stopped after confirm | ✓ VERIFIED | `ContainerCard.tsx:103–132` — Stop button is wrapped in full `AlertDialog` with container-specific text `This will stop {containerName}`; `AlertDialogAction` calls `onStop(container.id)`. `DashboardPage.tsx:71` — `onSuccess` calls `queryClient.invalidateQueries(['containers'])` triggering refetch and badge update. |
| 3 | Start button on stopped container changes badge to running | ✓ VERIFIED | `ContainerCard.tsx:148–161` — Start button rendered for `exited/dead/created/paused` states, calls `onStart(container.id)`. Mutation posts to `POST /api/containers/:id/start`. `onSuccess` invalidates query → fresh data → badge updates. |
| 4 | Restart button on running container works | ✓ VERIFIED | `ContainerCard.tsx:89–100` — Restart button rendered for `running` state, calls `onRestart(container.id)`. Mutation posts to `POST /api/containers/:id/restart`. `onSuccess` invalidates query. |
| 5 | All container actions require authentication; unauthenticated requests return 401 | ✓ VERIFIED | `server.ts:31` — `fastify.addHook('preHandler', verifyAuth)` registered **before** `containerRoutes`. `verify-auth.ts` excludes only `/api/auth/login`, `/api/auth/logout`, `/health` — `/api/containers` and `/api/containers/:id/*` are not excluded. Both JWT check and session-store check → 401 on failure. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/server/src/services/docker-ssh.ts` | ✓ VERIFIED | 93 lines. Implements `sshExec`, `listContainers`, `startContainer`, `stopContainer`, `restartContainer`, `isValidContainerId`. No stubs. |
| `packages/server/src/routes/containers.ts` | ✓ VERIFIED | 50 lines. GET `/api/containers`, POST `/api/containers/:id/start\|stop\|restart`. ID validation, error handling. |
| `packages/server/src/server.ts` | ✓ VERIFIED | Imports `containerRoutes`, registers after global `verifyAuth` preHandler. |
| `packages/web/src/pages/DashboardPage.tsx` | ✓ VERIFIED | 215 lines. Full TanStack Query integration (`useQuery` + `useMutation`). Loading/error/empty states. Container list render. |
| `packages/web/src/components/ContainerCard.tsx` | ✓ VERIFIED | 165 lines. Name, image, `StateBadge`, status text, action buttons, `AlertDialog` stop guard. |
| `packages/web/src/main.tsx` | ✓ VERIFIED | `QueryClientProvider` wraps `<App />`. |
| `packages/web/src/lib/axios.ts` | ✓ VERIFIED | `api.get('/containers')` and `api.post('/containers/${id}/${action}')` wired. 401 interceptor redirects to login. |
| `packages/web/src/components/ui/alert-dialog.tsx` | ✓ VERIFIED | 139 lines (full shadcn component, not stub). |
| `packages/web/src/components/ui/skeleton.tsx` | ✓ VERIFIED | 15 lines (standard shadcn skeleton). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `DashboardPage.tsx` | `GET /api/containers` | `api.get('/containers')` in `fetchContainers()` | ✓ WIRED | `DashboardPage.tsx:23` — `const { data } = await api.get('/containers')` |
| `DashboardPage.tsx` | `POST /api/containers/:id/action` | `api.post('/containers/${id}/${action}')` in `containerAction()` | ✓ WIRED | `DashboardPage.tsx:31` — `await api.post(...)` called by `useMutation` |
| `DashboardPage.tsx` | `ContainerCard.tsx` | props: container, isActing, onStart, onStop, onRestart | ✓ WIRED | `DashboardPage.tsx:199–206` — all callbacks wired |
| `ContainerCard.tsx` | `onStop` | `AlertDialogAction onClick` | ✓ WIRED | `ContainerCard.tsx:127` — `onClick={() => onStop(container.id)}` |
| `containerRoutes` | `listContainers` / actions | direct import from `docker-ssh.ts` | ✓ WIRED | `containers.ts:2–8` — full import; called at `containers.ts:21,39–41` |
| `server.ts` | `containerRoutes` | `fastify.register(containerRoutes)` | ✓ WIRED | `server.ts:4,34` |
| `verifyAuth` (preHandler) | all `/api/containers*` routes | `fastify.addHook('preHandler', ...)` | ✓ WIRED | `server.ts:31` — preHandler registered before route registration |
| `useMutation onSuccess` | `queryClient.invalidateQueries` | `['containers']` key | ✓ WIRED | `DashboardPage.tsx:71,79` — both success and error paths invalidate |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `DashboardPage.tsx` | `containers` (from `useQuery`) | `fetchContainers()` → `api.get('/containers')` → `GET /api/containers` → `listContainers()` → `sshExec('docker ps -a ...')` | Yes — `docker ps -a` via SSH; NDJSON parsed to `ContainerInfo[]` | ✓ FLOWING |
| `ContainerCard.tsx` | `container` prop | Populated from live `useQuery` data, not hardcoded | Yes — passed from parent with real server data | ✓ FLOWING |
| `containerAction()` | mutation response | `api.post(...)` → `POST /api/containers/:id/action` → `sshExec('docker start/stop/restart ...')` | Yes — SSH executes real Docker commands | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Server package TypeScript compiles | `cd packages/server && npx tsc --noEmit` | exit 0, 0 errors | ✓ PASS |
| Web package TypeScript compiles | `cd packages/web && npx tsc --noEmit` | exit 0, 0 errors | ✓ PASS |
| `QueryClientProvider` wraps app | `grep QueryClientProvider packages/web/src/main.tsx` | 3 matches | ✓ PASS |
| `useQuery` + `useMutation` in DashboardPage | `grep "useQuery\|useMutation" packages/web/src/pages/DashboardPage.tsx` | 4 matches | ✓ PASS |
| `AlertDialog` stop guard in ContainerCard | `grep AlertDialog packages/web/src/components/ContainerCard.tsx` | 9 import tokens + usage | ✓ PASS |
| Container ID injection guard | `grep CONTAINER_ID_RE packages/server/src/services/docker-ssh.ts` | `/^[a-zA-Z0-9]{12,64}$/` | ✓ PASS |
| Auth endpoint test (401 gate) | Confirmed via server.ts preHandler order + verifyAuth exclusion list | `/api/containers` not excluded | ✓ PASS |

---

### Probe Execution

No probe scripts declared for this phase. Step 7c: SKIPPED (no `scripts/*/tests/probe-*.sh` found).

---

### Requirements Coverage

| Plan | Requirement | Description | Status | Evidence |
|------|-------------|-------------|--------|----------|
| 02-01 | Docker SSH service | `listContainers`, `startContainer`, `stopContainer`, `restartContainer` via SSH | ✓ SATISFIED | All four functions implemented in `docker-ssh.ts` |
| 02-01 | REST endpoints | `GET /api/containers`, `POST /api/containers/:id/{start,stop,restart}` | ✓ SATISFIED | Fully implemented in `containers.ts` |
| 02-01 | Auth protection | All container endpoints return 401 without valid JWT | ✓ SATISFIED | Global `verifyAuth` preHandler in `server.ts` |
| 02-01 | Injection guard | Container ID validated before shell interpolation | ✓ SATISFIED | `isValidContainerId()` with `/^[a-zA-Z0-9]{12,64}$/` |
| 02-02 | Container list UI | Cards with name, image, state badge, status text | ✓ SATISFIED | `ContainerCard.tsx` + `StateBadge` |
| 02-02 | Action buttons | Start/Stop/Restart rendered per container state | ✓ SATISFIED | State-conditional rendering in `ContainerCard.tsx:86–161` |
| 02-02 | Stop confirmation | AlertDialog guard before stop | ✓ SATISFIED | `ContainerCard.tsx:103–132` |
| 02-02 | Polling | 5s auto-refresh | ✓ SATISFIED | `refetchInterval: 5000` in `DashboardPage.tsx:51` |
| 02-02 | Loading/error/empty states | Skeleton, error box, empty message | ✓ SATISFIED | All three states in `DashboardPage.tsx:139–192` |

---

### Anti-Patterns Found

| File | Pattern | Severity | Verdict |
|------|---------|----------|---------|
| `docker-ssh.ts` | `stream.stderr.on('data', () => { /* ignore stderr */ })` | ℹ️ Info | **Not a blocker.** stderr silently dropped — this is a documented design decision (SUMMARY: "stderr from docker commands silently ignored; only exit code determines success/failure"). Non-blocking. |

No `TBD`, `FIXME`, `XXX` markers found in any phase-2 file. No placeholder returns. No empty implementations.

---

### Human Verification Required

All 5 success criteria pass static analysis and data-flow tracing. The following items require a live Docker host to fully confirm end-to-end behavior and visual rendering:

#### 1. Container list renders correctly with live data

**Test:** SSH into a server with Docker containers, log in via the web UI, open the dashboard.  
**Expected:** Every container (running and stopped) appears in its own card showing: container name (bold), image name (muted), color-coded state badge (green = running, grey = exited), and human-readable uptime string (e.g. "Up 2 hours", "Exited (0) 3 days ago").  
**Why human:** `docker ps -a` output comes from a real SSH host; badge color rendering requires browser visual inspection.

#### 2. Stop confirmation dialog and badge state change

**Test:** Click "Stop" on a running container.  
**Expected:** AlertDialog modal appears, titled "Stop container?", naming the specific container. Click "Stop container" button. Within ~5 seconds (next refetch), the badge changes from green "running" to grey "exited".  
**Why human:** Requires live Docker host; UI state transition after mutation is a runtime behavior.

#### 3. Start button and badge update

**Test:** Click "Start" on an exited container.  
**Expected:** No confirmation dialog. Container starts; within ~5 seconds the badge changes to green "running".  
**Why human:** Requires live Docker host to confirm actual state change.

#### 4. Restart cycle visibility

**Test:** Click "Restart" on a running container.  
**Expected:** Container may briefly show "restarting" spinner state, then returns to green "running" badge.  
**Why human:** Real Docker restart timing and polling overlap depends on runtime behavior.

---

### Gaps Summary

No gaps. All 5 success criteria are implemented, wired, and data-flowing. TypeScript compiles cleanly in both packages. No anti-pattern blockers found.

The `human_needed` status reflects that live end-to-end testing with a real Docker host is required to confirm the runtime behavior described in success criteria 1–4. The implementation is complete and correct based on static analysis.

---

_Verified: 2026-05-25T12:00:00Z_  
_Verifier: gsd-verifier (agent)_
