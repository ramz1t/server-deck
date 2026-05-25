# Phase 3: Real-Time Container Status - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 replaces the 5-second polling interval with a WebSocket-based live push mechanism. A single persistent SSH connection streams `docker events` from Server B; each event triggers a fresh container list fetch which is then broadcast to all connected browser clients. The result: container state changes made outside the app (via CLI or other tools) appear in the dashboard within 2 seconds — no page refresh, no manual polling.

**In scope:** `docker events` SSH stream (one global, persistent), WebSocket endpoint with auth, server-side broadcast to all connected clients, frontend switching from `refetchInterval` polling to WS-driven updates, reconnect on disconnect.

**Out of scope:** Log streaming (Phase 4), SSH terminal (Phase 5), container metrics/CPU/memory, Docker event filtering beyond start/stop/die/restart events.

</domain>

<decisions>
## Implementation Decisions

### Docker Events Source
- **D-P3-01:** Docker events are captured via a **persistent SSH exec** running `docker events --format '{{json .}}'` on Server B. This is consistent with the Phase 2 SSH-first architecture (Server A → SSH → Server B); there is no direct socket access to Server B from Server A.
- **D-P3-02:** One global SSH connection for the events stream, opened at server startup (or lazily on first WebSocket client connection). Never one-per-client. On SSH disconnect or error, reconnect with exponential backoff (start 1s, max 30s).
- **D-P3-03:** Docker event types that trigger a container list refresh: `start`, `stop`, `die`, `kill`, `restart`, `pause`, `unpause`, `create`, `destroy`. Other events (network, volume, image) are ignored.
- **D-P3-04:** On each matching Docker event, the server calls the existing `listContainers()` SSH exec to get the full updated container list, then broadcasts it to all connected WS clients. This reuses the existing data model and avoids a separate `docker inspect` call.
- **D-P3-05:** The events SSH session and the per-request SSH sessions (for `listContainers()` on event) are separate connections. The events stream uses a long-lived connection; the list fetch uses a short-lived one (same pattern as Phase 2).
- **D-P3-06:** SSH credentials for the global events stream come from the first authenticated user's session (the only user for this single-user tool). On server startup before any login, the events stream is not yet open; it opens when the first user authenticates. If the user logs out, the stream stays open (no multi-user concern).

### Browser Push Mechanism
- **D-P3-07:** Browser push uses **WebSocket** via `@fastify/websocket ^11.2.0` — already in the stack, consistent with Phases 4 (log streaming) and 5 (SSH terminal). SSE would be replaced in a later phase; investing in WS now avoids rework.
- **D-P3-08:** WebSocket endpoint: `GET /api/containers/events` — upgrade to WebSocket. Auth is verified via cookie + JWT in a `preHandler` hook before the WS handshake completes (per D-20 from Phase 1).
- **D-P3-09:** The server maintains a `Set<WebSocket>` of connected clients. On each Docker event → container list refresh → broadcast JSON payload `{ type: 'containers', data: ContainerInfo[] }` to all clients.
- **D-P3-10:** On WS client connect, immediately send the current container list (avoids stale state between connect and first Docker event).
- **D-P3-11:** No heartbeat/ping-pong for v1 — acceptable for a personal LAN/VPN tool. Phase 6 can add it as part of hardening.

### Frontend Changes
- **D-P3-12:** Replace `refetchInterval: 5000` with a WebSocket connection. The frontend opens a WS to `/api/containers/events` on mount and updates the TanStack Query cache directly via `queryClient.setQueryData(['containers'], data)` on each `containers` message.
- **D-P3-13:** Keep the initial `useQuery` fetch (no change) for the first load. Once the WS connection is established, disable polling (`refetchInterval: false`). If the WS disconnects, re-enable polling as a fallback until reconnected.
- **D-P3-14:** Reconnect strategy: exponential backoff (1s → 2s → 4s → max 30s). Show a subtle "reconnecting…" indicator in the header when the WS is disconnected. Clear it on reconnect.
- **D-P3-15:** WS connection is managed in a custom `useContainerEvents` hook — keeps DashboardPage clean.

### Agent's Discretion
- Exact module path for the global events manager (e.g., `packages/server/src/services/docker-events.ts`) — agent decides.
- Whether to use Fastify's built-in `websocket` plugin broadcast or manage the client Set manually — agent decides based on `@fastify/websocket` API.
- Reconnect backoff implementation in the hook (setTimeout vs. a small utility) — agent decides.
- Whether `useContainerEvents` uses a `useRef` for the WS instance or a `useEffect`-scoped variable — agent decides.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, single-user constraint, Server A → Server B architecture
- `.planning/REQUIREMENTS.md` — CONT-03 (the single requirement this phase satisfies)

### Phase Roadmap
- `.planning/ROADMAP.md` §Phase 3 — 3 success criteria (2s update latency, one global stream verified)

### Prior Phase Decisions
- `.planning/phases/01-auth-foundation/01-CONTEXT.md` — D-20: WebSocket auth via preHandler hook; D-19: verifyAuth middleware pattern
- `.planning/phases/02-container-dashboard/02-CONTEXT.md` — D-P2-01–05: SSH exec architecture, `listContainers()` implementation, session structure

### Existing Implementation
- `packages/server/src/services/docker-ssh.ts` — `listContainers()`, `sshExec()`, `SessionData` type — reused by events manager
- `packages/server/src/server.ts` — where `@fastify/websocket` plugin registration and WS route registration happen
- `packages/server/src/middleware/verify-auth.ts` — auth preHandler pattern to replicate for WS route
- `packages/web/src/pages/DashboardPage.tsx` — current polling setup (`refetchInterval: 5000`) to replace with WS hook

### No external specs
No external ADRs beyond the above planning documents.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sshExec(session, command)` in `docker-ssh.ts` — reuse for the events SSH stream setup (same connect pattern, different long-lived usage)
- `listContainers(session)` in `docker-ssh.ts` — call this on each Docker event to get updated state before broadcasting
- `verifyAuth` in `verify-auth.ts` — replicate as WS `preHandler` to gate the `/api/containers/events` upgrade
- `useQuery(['containers'], fetchContainers)` in `DashboardPage.tsx` — keep for initial load, disable `refetchInterval` once WS active

### Established Patterns
- Per-request SSH connections (Phase 2): short-lived, open/exec/close per API call — the events stream diverges intentionally (persistent connection)
- `request.session` attached by `verifyAuth` preHandler — same pattern needed for WS route to get SSH credentials
- `queryClient.invalidateQueries(['containers'])` in mutations — replace with `queryClient.setQueryData` for WS-driven updates (avoids an extra network round-trip)

### Integration Points
- `server.ts` needs `@fastify/websocket` plugin registered before the WS route
- The global events SSH session needs SSH credentials — stored in the session Map after the first login; the events manager reads credentials from `sessionStore.getAnySession()` or a similar helper
- `DashboardPage.tsx` → `useContainerEvents` hook → WS → server broadcast → `queryClient.setQueryData`

</code_context>

<deferred>
## Deferred Ideas

- **Per-container event filtering** — only push deltas (changed container only) instead of full list. Would need `docker inspect` per event. → Optimization for Phase 6 if needed.
- **WS heartbeat/reconnect from server side** — ping/pong to detect stale clients. → Phase 6 hardening.
- **Multi-user broadcast isolation** — not needed for single-user tool. → Out of scope for v1.
- **Docker stats streaming** (CPU/memory) — separate event stream, not Docker events. → Out of scope for v1.

</deferred>

---

*Phase: 3-Real-Time Container Status*
*Context gathered: 2026-05-25 (autonomous — user unavailable)*
