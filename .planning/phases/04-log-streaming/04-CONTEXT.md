---
phase: 04-log-streaming
created: 2026-05-25
status: ready-for-planning
decisions_count: 15
---

<domain>
Phase 4 delivers live container log streaming. The user taps a "Logs" button on any container card and is taken to a dedicated log view page showing the last 200 lines of output, with new lines arriving in real time. ANSI colour codes render as coloured text. Closing the log view cleanly tears down the WebSocket and the underlying SSH exec process.

**In scope:** "Logs" button on ContainerCard → full-page log view route, WS-backed live `docker logs --follow --tail 200` via SSH, ANSI rendering with `ansi-to-html`, smart auto-scroll, clean teardown on close.
**Out of scope:** Log search/filter, log download, log persistence/storage, multi-container logs, SSH terminal (Phase 5).
</domain>

<decisions>
## Implementation Decisions

### Entry Point
- **D-P4-01:** A **"Logs" button** is added to each ContainerCard's action area. Tapping it navigates to `/logs/:containerId`. The button is present for all containers regardless of state (logs for stopped containers are still readable via `docker logs`). It uses the same ghost-button style as existing actions.
- **D-P4-02:** Container name is passed to the log view via React Router `state` (from `useNavigate`) — no extra API call needed on the log page.

### Routing
- **D-P4-03:** New route: `/logs/:containerId` — a new `LogPage` component. This is a **ProtectedRoute** (same auth wrapper as DashboardPage). Path param `:containerId` is the full container ID (not shortId) for WS URL construction.
- **D-P4-04:** LogPage header: back arrow (`←`) to `/` (dashboard), container name (from router state or fallback to shortId), and a "Disconnected" / live indicator badge.

### Backend WS Endpoint
- **D-P4-05:** New WS route: `GET /api/containers/:id/logs` — upgrades to WebSocket. Container `:id` is validated with the existing `isValidContainerId()` from `docker-ssh.ts`. Returns 400 on invalid ID. Auth via `preHandler: [verifyAuth]` (same belt-and-suspenders pattern as Phase 3).
- **D-P4-06:** On WS connect, server opens an SSH exec with `docker logs --follow --tail 200 <id>`. The command streams stdout (and stderr merged via `2>&1`) to the WS client. The SSH exec uses a short-lived connection opened specifically for this stream (same session credentials pattern as Phase 2/3).
- **D-P4-07:** Server sends each log line as a JSON message: `{ type: 'log', line: '<raw log line with ANSI codes>' }`. Lines are split on `\n` with the same NDJSON-style buffer pattern from Phase 3 (`buffer.split('\n')` + `lines.pop()`). Raw ANSI codes are kept in the line — the client renders them.
- **D-P4-08:** On WS close (client disconnects), the server kills the SSH exec stream immediately. Use `stream.close()` and `conn.end()` to avoid lingering file descriptors (LOGS-04). No reconnect logic server-side — client reconnects if needed.
- **D-P4-09:** No broadcast needed — each log WS serves exactly one client. The `Set<WebSocket>` pattern from Phase 3 is not needed here; the server-side handler is a simple 1-to-1 pipe: SSH stream → WS client.

### ANSI Rendering
- **D-P4-10:** Use **`ansi-to-html`** npm package on the **client side**. Each log line received is passed through `new Convert().toHtml(line)` before being inserted into the DOM. This converts ANSI escape codes to `<span style="color:...">` HTML — no xterm.js overhead. xterm.js is reserved for Phase 5's PTY SSH terminal.
- **D-P4-11:** Log lines are rendered in a `<pre>` element (or `<div>` with `font-family: monospace`) with `white-space: pre-wrap` and `overflow-wrap: break-word` — prevents horizontal scroll on mobile while preserving spacing. Dark background (`bg-black` or `bg-zinc-950`), light default text (`text-zinc-200`).

### Scroll Behavior
- **D-P4-12:** **Smart auto-scroll**: new log lines auto-scroll to the bottom while the user has not manually scrolled up. If the user scrolls up (detected via `scrollTop < scrollHeight - clientHeight - threshold`), auto-scroll pauses. A floating **"↓ Resume"** button appears at the bottom of the log view; tapping it re-enables auto-scroll and scrolls to bottom.
- **D-P4-13:** Auto-scroll threshold: 50px from the bottom. If the scroll position is within 50px of the bottom, auto-scroll is considered "active" even if the user moved slightly.

### Frontend Hook
- **D-P4-14:** New hook `useLogStream(containerId: string)` returns `{ lines: string[], connected: boolean }`. Uses the same `useEffect` + `useRef` + cleanup pattern as `useContainerEvents` from Phase 3. WS URL: `${protocol}//${window.location.host}/api/containers/${containerId}/logs`.
- **D-P4-15:** On WS message, append the `line` from `{ type: 'log', line: '...' }` to a local `lines` array (via `useState`). Cap at **5 000 lines** in memory to prevent runaway growth on very verbose containers — drop the oldest lines when the cap is reached.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/03-real-time-container-status/03-CONTEXT.md` — D-P3-07/08: @fastify/websocket pattern, belt-and-suspenders preHandler auth; NDJSON buffer pattern
- `.planning/phases/02-container-dashboard/02-CONTEXT.md` — D-P2-01–04: SSH exec pattern, `sshExec()`, session credentials flow; D-P2-07: `isValidContainerId()` regex
- `.planning/phases/01-auth-foundation/01-CONTEXT.md` — D-20: auth preHandler cookie+JWT pattern
- `.planning/REQUIREMENTS.md` — LOGS-01–04 requirements
- `.planning/ROADMAP.md` §Phase 4 — 4 success criteria (200-line tail, 1s latency, ANSI colors, clean teardown)
- `packages/server/src/services/docker-ssh.ts` — `isValidContainerId()`, `SessionData`, `sshExec()` pattern to reuse for log SSH exec
- `packages/server/src/routes/container-events.ts` — WS route pattern to follow (FastifyPluginAsync, preHandler, getSession helper)
- `packages/web/src/hooks/useContainerEvents.ts` — Hook pattern to follow for `useLogStream` (useEffect lifecycle, cleanup, onmessage parsing)
- `packages/web/src/components/ContainerCard.tsx` — Where "Logs" button will be added
- `packages/web/src/pages/DashboardPage.tsx` — Where router navigation to `/logs/:id` originates
</canonical_refs>

<code_context>
## Codebase Assets

### Reusable Patterns
- `sshExec(session, command)` in `docker-ssh.ts` — model for the SSH exec that runs `docker logs --follow --tail 200`. Divergence: do NOT call `conn.end()` on stream close; instead propagate stream close to WS close.
- `getSession(request)` in `container-events.ts` — verbatim copy for the new log WS route.
- `useContainerEvents` hook shape — `useLogStream` follows same structure: `useEffect` + `WebSocket` + `cancelled` flag + cleanup.
- NDJSON buffer pattern from `docker-events.ts` — reuse for splitting log output chunks on `\n`.

### Existing Assets to Extend
- `ContainerCard.tsx` — Add "Logs" button to actions area. Already has ghost-button pattern from Restart/Stop/Start.
- `packages/server/src/server.ts` — Add `containerLogsRoute` registration (after `containerEventsRoute`).
- `packages/web/src/App.tsx` (or router config) — Add `/logs/:containerId` route wrapped in ProtectedRoute.

### New Files Required
- `packages/server/src/routes/container-logs.ts` — WS route `GET /api/containers/:id/logs`
- `packages/web/src/pages/LogPage.tsx` — Full-page log view component
- `packages/web/src/hooks/useLogStream.ts` — WS hook returning `{ lines, connected }`

### Dependencies to Install
- `ansi-to-html` — client-side ANSI → HTML conversion (install in `packages/web`)
</code_context>

<deferred_ideas>
## Deferred Ideas (Future Phases)

- Log search/filter within the log view — useful but out of scope for v1 basic streaming
- Log download (save to file) — nice-to-have, future phase
- Timestamps toggle (show/hide Docker log timestamps) — trivial addition but defer to keep Phase 4 focused
- Line count configuration (user-selectable tail size) — defer; 200 is sufficient for v1
</deferred_ideas>
