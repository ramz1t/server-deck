# Phase 04 Plan 01 — Summary: Server Log WS Route

**Status:** Complete  
**Wave:** 1  
**Commit:** `feat(04-01): add container-logs WS route + server registration`

## Tasks Completed

### Task 1: container-logs.ts WS Route
- Created `packages/server/src/routes/container-logs.ts`
- `GET /api/containers/:id/logs` with `{ websocket: true, preHandler: [verifyAuth] }`
- Container ID validated via `isValidContainerId()` — `socket.close(1008)` on invalid ID
- SSH exec `docker logs --follow --tail 200 ${id} 2>&1` using `new Client()`
- NDJSON buffer: `buffer.split('\n')` + `lines.pop()` pattern from Phase 3
- Each line sent as `JSON.stringify({ type: 'log', line })`
- `stream.destroy()` in `socket.on('close')` — LOGS-04 compliance (not `stream.close()`)
- `conn.end()` in close handler, error handler, and exec error path
- TypeScript fix: generic passed to `fastify.get<{ Params: { id: string } }>` not handler param

### Task 2: server.ts Registration
- Added `containerLogsRoute` import from `./routes/container-logs.js`
- Registered after `containerEventsRoute` (correct order maintained)

## Verification
- `npx tsc --noEmit` (packages/server): ✅ clean
- `stream.destroy()` present: ✅
- `isValidContainerId` present: ✅
- Registration order correct: ✅

## Key Decisions Applied
- D-P4-05: Route at `/api/containers/:id/logs`
- D-P4-06: `docker logs --follow --tail 200` SSH command
- D-P4-07: `{ type: 'log', line }` JSON per line
- D-P4-08: `stream.destroy()` + `conn.end()` teardown (CRITICAL — LOGS-04)
- D-P4-09: `isValidContainerId` before SSH exec
