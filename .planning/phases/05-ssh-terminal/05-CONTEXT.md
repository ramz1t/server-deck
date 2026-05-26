# Phase 5: SSH Terminal - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a full PTY-backed SSH terminal accessible from a phone browser: xterm.js rendered in a full-page view, connected to the server via WebSocket → ssh2 → localhost PTY. Includes a mobile touch toolbar for common shell keys and clean session lifecycle (no zombie processes).

</domain>

<decisions>
## Implementation Decisions

### Entry Point & Navigation
- **D-P5-01:** "Terminal" button lives in the sticky header (same row as Refresh and Log Out), always visible on every authenticated screen. Route: `/terminal`.
- **D-P5-02:** Navigating to `/terminal` is a push navigation — user can go back to the dashboard with the browser back button or a back chevron in the terminal header.
- **D-P5-03:** No container-specific terminal (that would be `docker exec`). The terminal always connects to the server's own shell (ssh to localhost).

### Terminal Layout
- **D-P5-04:** Full-page view (same pattern as LogPage). Header bar contains: back arrow, title "Terminal", connection status badge (Connecting / Connected / Disconnected), and an X close button that terminates the session and navigates back.
- **D-P5-05:** Terminal fills `calc(100dvh - {header height} - {toolbar height})`. Use CSS variable for header height to stay in sync with changes.
- **D-P5-06:** No split view or embedded panel — full-screen terminal is the right mobile UX. Split view is a v2 idea.
- **D-P5-07:** Background color of the terminal container matches xterm.js theme background (zinc-950) so there is no color mismatch during resize or keyboard pop-up.

### Touch Toolbar
- **D-P5-08:** Touch toolbar is fixed at the bottom of the screen, above the iOS home indicator: `position: fixed; bottom: 0; padding-bottom: env(safe-area-inset-bottom)`.
- **D-P5-09:** Toolbar height is 44px (minimum tap target) + `env(safe-area-inset-bottom)`. This value must be subtracted from terminal height via CSS var.
- **D-P5-10:** Toolbar buttons (in order): `Ctrl`, `Tab`, `Esc`, `↑`, `↓`, `←`, `→`, `|`, `` ` ``, `~`, `/`. These are the most common shell characters that are hard to type on mobile keyboards without switching to a symbol keyboard.
- **D-P5-11:** Ctrl is a modifier: first tap Ctrl highlights it (active state), then tapping a letter key sends the correct ctrl sequence (Ctrl+C = \x03, Ctrl+D = \x04, Ctrl+L = \x0c, etc.). Second tap Ctrl deactivates without sending anything. No need to type actual letters via toolbar — keyboard handles letters.
- **D-P5-12:** All other toolbar buttons (Tab, Esc, arrows, symbols) write directly to the xterm terminal via `terminal.write(sequence)` and `socket.send(sequence)`.
- **D-P5-13:** Toolbar is always visible (no dismiss button) — it's compact (44px) and the main value of the terminal on mobile.

### SSH Connection & Session Lifecycle
- **D-P5-14:** Backend WS route: `GET /api/terminal` (no path params — always connects to localhost as the configured user). Pattern follows `container-logs.ts`.
- **D-P5-15:** SSH config: `host: 'localhost'`, `port: 22`, `username` and `privateKey` from env vars `SSH_USERNAME` and `SSH_KEY_PATH`. These are read at startup and validated. If missing → server startup error (fail fast).
- **D-P5-16:** PTY shell: `conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 })` — initial size. Actual cols/rows are sent by the client in the first message after connection (resize protocol below).
- **D-P5-17:** Resize protocol: client sends JSON message `{ type: 'resize', cols: N, rows: N }` when FitAddon calculates terminal dimensions. All other messages are raw PTY data (binary or text). Server distinguishes via `JSON.parse` try/catch — if it's valid `{ type: 'resize' }`, call `stream.setWindow(rows, cols, 0, 0)`; otherwise pipe raw to PTY stdin.
- **D-P5-18:** Session teardown: `stream.destroy()` then `conn.end()` in the WS `close` and `error` handlers. This is the zombie-prevention pattern locked in STATE.md.
- **D-P5-19:** No auto-reconnect. SSH sessions are stateful — reconnecting would start a fresh shell, losing context. User must navigate back and re-open Terminal. The close/error state shows a "Session ended" message with a "Reconnect" button that navigates to `/terminal` (fresh load).

### Connection Failure UX
- **D-P5-20:** If SSH connection fails (wrong key, SSH not running, port closed): show an inline error message inside the terminal container (not a full page error). Error text: "Connection failed: {error.message}". Include a "Retry" button that re-mounts the component (triggers fresh WS connection attempt).
- **D-P5-21:** Connection state machine: `connecting` → `connected` | `failed`. In `connecting` state, show a spinner with "Connecting…" text in the terminal area. In `failed` state, show the error + Retry.

### xterm.js Integration
- **D-P5-22:** Use `@xterm/addon-attach` for WS-to-terminal bidirectional data flow. The AttachAddon handles piping WS messages to terminal output and terminal input to WS send.
- **D-P5-23:** Use `@xterm/addon-fit` to calculate cols/rows from container size. Wrap `fitAddon.fit()` in `requestAnimationFrame` (prevents pre-layout call, locked in STATE.md).
- **D-P5-24:** Terminal theme: match app's zinc dark palette. Background: `#09090b` (zinc-950), foreground: `#e4e4e7` (zinc-200), cursor: `#a1a1aa` (zinc-400). Standard ANSI colors use shadcn zinc-aligned palette.
- **D-P5-25:** `terminal.dispose()` on component unmount — prevents WebGL context exhaustion on iOS (locked in STATE.md).
- **D-P5-26:** Input element attributes on the xterm container: no explicit DOM input needed — xterm.js handles its own focus model. But the parent div should have `autocorrect="off"` `autocapitalize="off"` `spellcheck="false"` `data-gramm="false"` (MOBL-04 preemptive fix).

### the agent's Discretion
- Choice of toolbar scrollability: if all 11 buttons don't fit on narrow screens (< 375px), the toolbar scrolls horizontally. Styling up to the agent.
- Exact xterm color palette values for ANSI colors 0–15: use standard terminal palette, aligned with zinc where reasonable.
- Whether to show PTY output in the connecting/failed state overlay or below it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §SSH Terminal — SSH-01 through SSH-06, exact requirements for this phase
- `.planning/ROADMAP.md` §Phase 5 — success criteria and phase goal

### Existing Code Patterns (MUST read — mirror these)
- `packages/server/src/routes/container-logs.ts` — WS route pattern: `fastify.get<{Params}>`, `preHandler: [verifyAuth]`, SSH stream lifecycle, `stream.destroy()` + `conn.end()` teardown
- `packages/web/src/hooks/useLogStream.ts` — WS hook pattern: connection lifecycle, cleanup, error handling
- `packages/web/src/pages/LogPage.tsx` — full-page layout pattern: header with back + title + status, content fills remaining dvh
- `packages/server/src/middleware/verify-auth.ts` — auth middleware (same pattern for WS route)
- `packages/server/src/server.ts` — plugin registration order (websocket plugin must be first)

### State — Locked Decisions
- `.planning/STATE.md` §Accumulated Context → Key Decisions: stack, auth, WebSocket registration order, SSH zombie prevention pattern, iOS viewport pitfalls, FitAddon timing, terminal dispose

### Research (read for SSH + xterm pitfalls)
- `.planning/research/ARCHITECTURE.md` — integration architecture, existing research

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/web/src/pages/LogPage.tsx` — full-page layout with sticky header, back nav, status badge. Terminal page should follow the same structure.
- `packages/web/src/hooks/useLogStream.ts` — WS lifecycle hook. SSH terminal hook will be structurally similar but bidirectional (useTerminalSession instead of useLogStream).
- `packages/server/src/routes/container-logs.ts` — WS route implementation. `container-logs.ts` is the direct analog for the SSH WS route.
- `packages/server/src/services/docker-ssh.ts` — SSH Client creation pattern (`new Client()`, private key loading, `conn.connect()`).
- `packages/web/src/components/ui/` — shadcn/ui button, badge components available for toolbar and status badge.

### Established Patterns
- WS route: `fastify.get<{Params}>(path, { websocket: true, preHandler: [verifyAuth] }, handler)` — use exactly this pattern
- WS teardown: `stream.destroy()` then `conn.end()` in both `ws.on('close')` and `ws.on('error')` — non-negotiable (zombie prevention)
- Auth: httpOnly JWT cookie checked by `verifyAuth` preHandler — no additional auth logic needed in route
- Page navigation: `useNavigate()` + `navigate(-1)` for back button (established in LogPage)

### Integration Points
- `packages/server/src/server.ts`: add `sshTerminalRoute` import + `fastify.register(sshTerminalRoute)` after `containerLogsRoute`
- `packages/web/src/App.tsx`: add `<Route path="terminal" element={<TerminalPage />} />` inside `<ProtectedRoute>`
- `packages/web/src/pages/DashboardPage.tsx`: add "Terminal" button to sticky header (line ~165-193 header section)

</code_context>

<specifics>
## Specific Ideas

- Touch toolbar always visible (no dismiss), fixed to bottom with `env(safe-area-inset-bottom)` padding — critical for iPhone notch/home indicator avoidance
- Ctrl modifier key has active/inactive state (highlighted when waiting for next key)
- Resize messages are JSON `{ type: 'resize', cols, rows }` — server distinguishes from raw PTY data via JSON.parse try/catch
- Route is `/terminal` (no path params) — single server terminal, not per-container

</specifics>

<deferred>
## Deferred Ideas

- **Split view / side-by-side dashboard + terminal** — would require complex layout; better as a v2 desktop feature
- **`docker exec` into container** — a separate capability from SSH terminal; belongs in a future phase (EXEC-01/02 already in v2 requirements)
- **Multiple terminal tabs** — out of scope for v1.1; single PTY session is sufficient
- **Terminal history persistence** — session transcript saved across navigations; future phase

</deferred>

---

*Phase: 5-SSH Terminal*
*Context gathered: 2026-05-26*
