# 03-01 SUMMARY: Install @fastify/websocket + DockerEventsManager Service

**Phase:** 03-real-time-container-status
**Plan:** 03-PLAN-backend-ws (Wave 1)
**Status:** ✅ Complete

## What Was Built

The server-side half of the live-push pipeline — a persistent SSH `docker events` stream with WebSocket broadcast to authenticated clients.

### Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `packages/server/src/services/docker-events.ts` | Created | DockerEventsManager singleton |
| `packages/server/src/routes/container-events.ts` | Created | WS route GET /api/containers/events |
| `packages/server/src/server.ts` | Modified | Register @fastify/websocket + containerEventsRoute |
| `packages/server/package.json` | Modified | Added @fastify/websocket ^11.2.0, @types/ws ^8.18.1 |

## Tasks Completed

### Task 1: Install packages and create DockerEventsManager
- Installed `@fastify/websocket ^11.2.0` and `@types/ws ^8.18.1` via npm
- Created `DockerEventsManager` class with:
  - Persistent SSH exec: `docker events --format '{{json .}}'`
  - NDJSON buffering: `buffer.split('\n')` + `lines.pop()` for incomplete fragments
  - WATCHED_ACTIONS filter: start/stop/die/kill/restart/pause/unpause/create/destroy
  - 150ms debounce via `DEBOUNCE_MS` to coalesce rapid events (e.g. docker restart)
  - Exponential backoff reconnect: 1s→2s→4s→…→30s max (`scheduleReconnect()` captures delay before doubling)
  - `keepaliveInterval: 30_000` for long-lived SSH stream
  - `ws.readyState === 1` guard on all `ws.send()` calls
  - `sendCurrentList()` pushes snapshot to new client immediately on connect (D-P3-10)
  - Stream stays open even at 0 clients (per D-P3-02)
- Exported `eventsManager` singleton

### Task 2: Create WS route and register plugin in server.ts
- Created `containerEventsRoute: FastifyPluginAsync` for `GET /api/containers/events`
  - Route options: `{ websocket: true, preHandler: [verifyAuth] }` (belt-and-suspenders auth)
  - `getSession()` helper (same pattern as containers.ts)
  - Delegates client lifecycle to `eventsManager.addClient()` / `eventsManager.removeClient()`
- Modified `server.ts`:
  - Added `import websocket from '@fastify/websocket'`
  - `await fastify.register(websocket)` **first** — before all other plugins
  - `await fastify.register(containerEventsRoute)` after containerRoutes
  - Final order: websocket → authPlugins → preHandler hook → authRoutes → containerRoutes → containerEventsRoute → /health

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (packages/server) | ✅ exit 0, no errors |
| `@fastify/websocket` in package.json dependencies | ✅ |
| `@types/ws` in package.json devDependencies | ✅ |
| `eventsManager` export | ✅ |
| All 9 WATCHED_ACTIONS present | ✅ |
| NDJSON buffer logic present | ✅ |
| 150ms debounce present | ✅ |
| `keepaliveInterval: 30_000` | ✅ |
| `ws.readyState === 1` guard on all sends | ✅ (2 locations) |
| `containerEventsRoute` exported | ✅ |
| `websocket` imported from `@fastify/websocket` in server.ts | ✅ |
| `register(websocket)` before `registerAuthPlugins` | ✅ line 31 vs 33 |
| `register(containerEventsRoute)` after `register(containerRoutes)` | ✅ line 39 vs 38 |
| Route uses `{ websocket: true, preHandler: [verifyAuth] }` | ✅ |
| Route imports `verifyAuth` | ✅ |
| `addClient` + `removeClient` delegation | ✅ |

## Deviations

None. Implementation follows plan exactly.

## Key Links Verified

- `container-events.ts` → `docker-events.ts` via `eventsManager.addClient/removeClient` ✅
- `docker-events.ts` → `docker-ssh.ts` via `listContainers(this.session)` ✅
- `server.ts` → `container-events.ts` via `fastify.register(containerEventsRoute)` ✅

## Git Commits

- `fdec4b6` — feat(03-01): install @fastify/websocket + DockerEventsManager service
- `e6a72f0` — feat(03-01): WS route GET /api/containers/events + server.ts registration

## Self-Check: PASSED

All acceptance criteria verified. TypeScript compiles clean. Backend WS pipeline is ready for Wave 2 (frontend).
