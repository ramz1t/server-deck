---
phase: 04-log-streaming
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/server/src/routes/container-logs.ts
  - packages/server/src/server.ts
autonomous: true
requirements:
  - LOGS-01
  - LOGS-02
  - LOGS-03
  - LOGS-04

must_haves:
  truths:
    - "GET /api/containers/:id/logs upgrades to WebSocket — unauthenticated requests are rejected"
    - "On WS connect, server opens docker logs --follow --tail 200 <id> via SSH exec"
    - "Each log line is sent as JSON { type: 'log', line: '...' } — ANSI codes preserved, lines split on \\n"
    - "On WS close, stream.destroy() + conn.end() fire — no lingering SSH channel or docker logs process"
    - "Invalid container ID (fails isValidContainerId) closes socket with code 1008 before SSH exec runs"
  artifacts:
    - path: "packages/server/src/routes/container-logs.ts"
      provides: "WS route GET /api/containers/:id/logs"
      exports: ["containerLogsRoute"]
    - path: "packages/server/src/server.ts"
      provides: "Plugin registration"
      contains: "containerLogsRoute"
  key_links:
    - from: "packages/server/src/routes/container-logs.ts"
      to: "packages/server/src/services/docker-ssh.ts"
      via: "isValidContainerId import"
      pattern: "isValidContainerId"
    - from: "packages/server/src/routes/container-logs.ts"
      to: "ssh2 Client"
      via: "conn.exec docker logs --follow --tail 200"
      pattern: "docker logs.*--follow.*--tail 200"
    - from: "packages/server/src/routes/container-logs.ts"
      to: "ws.on('close')"
      via: "stream.destroy() + conn.end()"
      pattern: "stream\\.destroy"
---

<objective>
Create the server-side WebSocket route that streams live Docker logs to a single connected client.
The route opens an SSH exec running `docker logs --follow --tail 200 <id>`, splits chunks on newlines
using the NDJSON buffer pattern from Phase 3, and sends each line as `{ type: 'log', line }` JSON.
On WS disconnect, it calls `stream.destroy()` (not `stream.close()`) to ensure the SSH channel EOF
is sent so the remote `docker logs` process terminates — preventing lingering file descriptors (LOGS-04).

Purpose: Backend half of the live log streaming feature. Frontend plan (04-02) connects to this endpoint.
Output: `container-logs.ts` route file + `server.ts` updated with registration.
</objective>

## Phase Goal

**As a** developer using ServerDeck, **I want to** watch live container logs stream in my browser,
**so that** I can monitor output without SSH-ing into the server manually.

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/04-log-streaming/04-CONTEXT.md
@.planning/phases/04-log-streaming/04-RESEARCH.md
@.planning/phases/04-log-streaming/04-PATTERNS.md
@packages/server/src/routes/container-events.ts
@packages/server/src/services/docker-ssh.ts
@packages/server/src/server.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create container-logs.ts WS route (Wave 1)</name>
  <files>packages/server/src/routes/container-logs.ts</files>
  <action>
Create `packages/server/src/routes/container-logs.ts` as a new file. Model the overall
structure on `container-events.ts` — same import shape, same `getSession` helper (verbatim copy),
same plugin registration pattern. Key divergences from the Phase 3 analog:

IMPORTS (per D-P4-05, D-P4-09, and PATTERNS.md imports block):
- `import type { FastifyPluginAsync, FastifyRequest } from 'fastify'`
- `import type { WebSocket } from 'ws'`
- `import { Client } from 'ssh2'`
- `import { verifyAuth } from '../middleware/verify-auth.js'` (.js extension required — all server imports)
- `import type { SessionData } from '../types/session.js'`
- `import { isValidContainerId } from '../services/docker-ssh.js'`

getSession HELPER: Copy verbatim from container-events.ts lines 7–14. Do not alter.

ROUTE REGISTRATION (per D-P4-05):
- Path: `/api/containers/:id/logs`
- Options: `{ websocket: true, preHandler: [verifyAuth] }`
- Handler signature: `(socket: WebSocket, req: FastifyRequest<{ Params: { id: string } }>)`

VALIDATION (per D-P4-09): At the top of the handler, extract `id` from `req.params`.
Call `isValidContainerId(id)`. If it returns false, call `socket.close(1008, 'Invalid container ID')`
and return immediately. Do not open an SSH connection.

SSH CONNECTION (per D-P4-06): Use `new Client()`. In the `ready` event, call `conn.exec` with:
```
docker logs --follow --tail 200 ${id} 2>&1
```
SSH connect options (copy from PATTERNS.md SSH connection config block):
`host`, `port`, `username`, `password` from `session`; `readyTimeout: 10_000`, `keepaliveInterval: 0`.

NDJSON BUFFER PATTERN (per D-P4-07 — copy from PATTERNS.md NDJSON buffer block):
Declare `let buffer = ''` before `stream.on('data', ...)`. Inside `data` handler:
- Append `chunk.toString()` to buffer
- Split on `\n`, pop last fragment back into buffer
- For each non-empty trimmed line, call `socket.send(JSON.stringify({ type: 'log', line }))`
- Wrap `socket.send` in a try/catch — socket may have closed mid-stream

STREAM CLOSE HANDLER: In `stream.on('close', ...)`, call `conn.end()` wrapped in try/catch,
then call `socket.close()` wrapped in try/catch.

SSH ERROR HANDLER: In `conn.on('error', ...)`, log the error, call `conn.end()` in try/catch,
call `socket.close(1011, 'SSH error')` in try/catch.

EXEC ERROR: In the `conn.exec` callback, if `err` is truthy, call `socket.close(1011, 'SSH exec failed')`
and `conn.end()` in try/catch, then return.

TEARDOWN ON WS CLOSE (per D-P4-08 — CRITICAL for LOGS-04):
After starting the SSH connection, add:
```
socket.on('close', () => {
  try { stream.destroy() } catch { /* ignore */ }
  try { conn.end() } catch { /* ignore */ }
})
```
IMPORTANT: `stream.destroy()` must be called, NOT `stream.close()`. `destroy()` sends both
the stream EOF and SSH_MSG_CHANNEL_CLOSE. `close()` alone skips the EOF signal, leaving the
remote `docker logs` process running and leaking the SSH channel (confirmed from ssh2 Channel.js
source in RESEARCH.md). This is the fix for LOGS-04.

NOTE on scope: The `stream` variable referenced in `socket.on('close')` is the exec stream
returned by `conn.exec`. Declare it with `let stream: import('ssh2').ClientChannel | null = null`
in the handler scope above `conn.on('ready')`, assign it inside the exec callback, so the
close handler can reference it. Same pattern for the conn reference.

Export the plugin as `export const containerLogsRoute: FastifyPluginAsync = async (fastify) => { ... }`.
  </action>
  <verify>
    <automated>pnpm --filter @serverdeck/server tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - `packages/server/src/routes/container-logs.ts` exists and exports `containerLogsRoute`
    - `pnpm --filter @serverdeck/server tsc --noEmit` passes with no errors
    - Route uses `{ websocket: true, preHandler: [verifyAuth] }` options
    - `isValidContainerId` called before SSH exec; socket closed with 1008 on failure
    - `stream.destroy()` present in `socket.on('close')` handler (not `stream.close()`)
    - `conn.end()` called in both teardown path and error paths
    - NDJSON buffer splits on `\n`, pops last fragment, sends `{ type: 'log', line }` JSON per line
  </done>
</task>

<task type="auto">
  <name>Task 2: Register containerLogsRoute in server.ts (Wave 2)</name>
  <files>packages/server/src/server.ts</files>
  <action>
Modify `packages/server/src/server.ts`. Two changes only:

1. ADD IMPORT (after the existing `containerEventsRoute` import on line 6, per PATTERNS.md
   registration order block):
   ```
   import { containerLogsRoute } from './routes/container-logs.js'
   ```

2. ADD REGISTRATION (after the existing `await fastify.register(containerEventsRoute)` on line 39,
   per D-P4-05 and PATTERNS.md registration order block):
   ```
   await fastify.register(containerLogsRoute)
   ```

No other changes to server.ts. Do not reorder existing registrations.
  </action>
  <verify>
    <automated>pnpm --filter @serverdeck/server tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - `server.ts` imports `containerLogsRoute` from `./routes/container-logs.js`
    - `await fastify.register(containerLogsRoute)` appears after `containerEventsRoute` registration
    - `pnpm --filter @serverdeck/server tsc --noEmit` still passes with no errors
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → WS route | Any caller can attempt `GET /api/containers/:id/logs` upgrade; must be rejected if unauthenticated |
| URL param `:id` → SSH exec | Container ID from URL is concatenated into shell command; must be validated before use |
| SSH exec stdout → WS send | Log output from a container is untrusted; raw bytes are relayed as-is (ANSI escaping is client-side) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-01 | Spoofing | WS route auth | mitigate | `preHandler: [verifyAuth]` runs before upgrade; unauthenticated connections rejected at hook stage |
| T-04-02 | Tampering | `:id` URL param → `docker logs` shell arg | mitigate | `isValidContainerId()` validates `/^[a-zA-Z0-9]{12,64}$/` before SSH exec; socket closed 1008 on failure |
| T-04-03 | Denial of Service | Long-running SSH exec per client | accept | Single-user app; each client gets one stream; no connection pooling needed at this scale |
| T-04-04 | Information Disclosure | Log content relayed over WS | accept | Route is auth-gated; log content is already accessible to authenticated user via `docker logs` |
| T-04-05 | Elevation of Privilege | SSH exec scope | accept | Exec runs as SSH user (same as Phase 2/3 container actions); no privilege expansion |
| T-04-06 | Denial of Service | WS close without teardown → zombie docker logs | mitigate | `stream.destroy()` in `socket.on('close')` — verified in RESEARCH.md to kill SSH channel EOF |
| T-04-SC | Tampering | npm/pip/cargo installs | mitigate | No new server-side packages installed in this plan; ansi-to-html is client-side only (Plan 02) |
</threat_model>

<verification>
After both tasks complete:

```bash
# TypeScript clean compile
pnpm --filter @serverdeck/server tsc --noEmit

# Route file exists and exports the plugin
grep -c "containerLogsRoute" packages/server/src/routes/container-logs.ts

# stream.destroy() is present (not stream.close())
grep "stream\.destroy" packages/server/src/routes/container-logs.ts

# isValidContainerId called in route
grep "isValidContainerId" packages/server/src/routes/container-logs.ts

# Registration order in server.ts
grep -n "containerEventsRoute\|containerLogsRoute" packages/server/src/server.ts
```
</verification>

<success_criteria>
- `packages/server/src/routes/container-logs.ts` exports `containerLogsRoute: FastifyPluginAsync`
- Route `GET /api/containers/:id/logs` is registered with `websocket: true` and `preHandler: [verifyAuth]`
- `isValidContainerId(id)` called before SSH exec; `socket.close(1008, ...)` on invalid ID
- SSH exec runs `docker logs --follow --tail 200 ${id} 2>&1`
- NDJSON buffer splits lines on `\n`; each line sent as `{ type: 'log', line }`
- `stream.destroy()` fires in `socket.on('close')` handler (LOGS-04 compliance)
- `conn.end()` fires in close handler, error handler, and exec error path
- `server.ts` registers `containerLogsRoute` after `containerEventsRoute`
- `pnpm --filter @serverdeck/server tsc --noEmit` passes with zero errors
</success_criteria>

<output>
Create `.planning/phases/04-log-streaming/04-01-SUMMARY.md` when done
</output>
