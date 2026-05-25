---
phase: 04-log-streaming
verified: 2025-01-30T00:00:00Z
status: human_needed
score: 19/19 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open a container log view in a browser and observe output"
    expected: "Last ~200 lines appear immediately on open; new lines stream in within 1s"
    why_human: "Requires live Docker host over SSH — cannot test without running server"
  - test: "Produce ANSI-coloured output (e.g. docker run alpine sh -c 'echo -e \\033[32mGREEN\\033[0m')"
    expected: "Text renders as coloured in the browser, not raw escape sequences"
    why_human: "ANSI rendering requires a live browser DOM — cannot assert visually with grep"
  - test: "Scroll up in the log view while new lines arrive"
    expected: "Auto-scroll pauses; 'Resume' button appears; clicking it scrolls to bottom"
    why_human: "Scroll behaviour requires interactive browser session"
  - test: "Close the log view (navigate back) while logs are streaming"
    expected: "No lingering processes on the server; SSH channel and docker logs process both terminate"
    why_human: "Requires inspecting live server process table / SSH channel state"
---

# Phase 4: Log Streaming — Verification Report

**Phase Goal:** Users can open a live log view for any container and watch output stream in real time.  
**Verified:** 2025-01-30  
**Status:** HUMAN_NEEDED — all automated checks PASS; 4 runtime behaviours need human confirmation  
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `/api/containers/:id/logs` upgrades to WS; `verifyAuth` preHandler rejects unauthed requests | ✓ VERIFIED | `{ websocket: true, preHandler: [verifyAuth] }` in `container-logs.ts` line ~20 |
| 2  | On WS connect, server runs `docker logs --follow --tail 200 <id>` via SSH exec | ✓ VERIFIED | `conn.exec(\`docker logs --follow --tail 200 ${id} 2>&1\`, ...)` in `container-logs.ts` |
| 3  | Lines sent as JSON `{ type:'log', line:'...' }`, ANSI preserved, split on `\n` | ✓ VERIFIED | `socket.send(JSON.stringify({ type: 'log', line: trimmed }))` after `buffer.split('\n')` |
| 4  | On WS close, `stream.destroy()` called (not `stream.close()`) | ✓ VERIFIED | `socket.on('close', () => { try { if (stream) stream.destroy() } ... })` |
| 5  | Invalid container ID → `socket.close(1008)` before SSH exec | ✓ VERIFIED | `if (!isValidContainerId(id)) { socket.close(1008, 'Invalid container ID'); return; }` — executes before `conn.connect()` |
| 6  | `containerLogsRoute` registered after `containerEventsRoute` in `server.ts` | ✓ VERIFIED | Lines 40–41 of `server.ts`: `register(containerEventsRoute)` then `register(containerLogsRoute)` |
| 7  | `useLogStream` connects to `/api/containers/${containerId}/logs` WS path | ✓ VERIFIED | `const wsUrl = \`${protocol}//...host}/api/containers/${containerId}/logs\`` |
| 8  | Lines capped at 5000 via functional updater + `slice(next.length - 5000)` | ✓ VERIFIED | `return next.length > 5000 ? next.slice(next.length - 5000) : next` in `useLogStream.ts` |
| 9  | Cleanup closes WS on unmount → triggers server `stream.destroy()` | ✓ VERIFIED | `return () => { cancelled = true; ...; wsRef.current.close() }` in `useLogStream.ts` |
| 10 | `new Convert({ escapeXML: true, stream: true })` at module level in `LogPage.tsx` | ✓ VERIFIED | `const converter = new Convert({ escapeXML: true, stream: true })` before component fn |
| 11 | Lines rendered via `dangerouslySetInnerHTML={{ __html: html }}` | ✓ VERIFIED | `<div dangerouslySetInnerHTML={{ __html: html }} />` inside `<pre>` in `LogPage.tsx` |
| 12 | Auto-scroll pauses >50px from bottom; Resume button present | ✓ VERIFIED | `el.scrollTop >= el.scrollHeight - el.clientHeight - 50` threshold + `{showResume && <button>↓ Resume</button>}` |
| 13 | `ContainerCard` Logs button (`variant="ghost"`) precedes state-conditional buttons | ✓ VERIFIED | Logs `<Button variant="ghost" ...>` is first in the action row, before `container.state === 'running'` check |
| 14 | `App.tsx` has `<Route path="logs/:containerId" element={<LogPage />}>` inside `ProtectedRoute` | ✓ VERIFIED | `<Route path="/" element={<ProtectedRoute />}><Route path="logs/:containerId" .../>` in `App.tsx` |
| 15 | `DashboardPage.handleLogs` navigates to `/logs/${id}` with `{ state: { name } }` | ✓ VERIFIED | `navigate(\`/logs/${id}\`, { state: { name: container?.names[0] ?? id.slice(0, 12) } })` |
| 16 | **LOGS-01** User can open a live log view (ContainerCard → LogPage route) | ✓ VERIFIED | Full path wired: Logs button → `onLogs` prop → `handleLogs` → `navigate` → `<LogPage>` |
| 17 | **LOGS-02** Logs stream in real time via WebSocket (`useLogStream` + WS route) | ✓ VERIFIED | WS route and hook both implemented and fully wired |
| 18 | **LOGS-03** Last ~200 lines shown immediately on open (`--tail 200`) | ✓ VERIFIED | `--tail 200` present in `docker logs` command in `container-logs.ts` |
| 19 | **LOGS-04** Log stream cleanly terminated on close (`stream.destroy()` + WS close) | ✓ VERIFIED | `stream.destroy()` in server WS `close` handler; `wsRef.current.close()` in hook cleanup |

**Score: 19/19 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/routes/container-logs.ts` | WS route with auth + SSH exec | ✓ VERIFIED | ~80 lines; substantive; registered in server.ts |
| `packages/server/src/server.ts` | Route registration | ✓ VERIFIED | Imports + registers both event and log routes |
| `packages/web/src/hooks/useLogStream.ts` | WS hook with cleanup | ✓ VERIFIED | Reconnection backoff, 5000-line cap, cancel flag |
| `packages/web/src/pages/LogPage.tsx` | Log view UI | ✓ VERIFIED | ANSI convert, auto-scroll, Resume button, dangerouslySetInnerHTML |
| `packages/web/src/components/ContainerCard.tsx` | Logs button wired | ✓ VERIFIED | `variant="ghost"` Logs button calls `onLogs(container.id)` |
| `packages/web/src/App.tsx` | Route registered under ProtectedRoute | ✓ VERIFIED | `<Route path="logs/:containerId" element={<LogPage />} />` inside ProtectedRoute |
| `packages/web/src/pages/DashboardPage.tsx` | `handleLogs` navigates with name state | ✓ VERIFIED | `navigate(\`/logs/${id}\`, { state: { name: ... } })` |
| `packages/web/package.json` | `ansi-to-html` dependency | ✓ VERIFIED | `"ansi-to-html": "^0.7.2"` present; package installed in `node_modules` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ContainerCard` | `DashboardPage.handleLogs` | `onLogs` prop | ✓ WIRED | `onLogs={handleLogs}` in DashboardPage render |
| `DashboardPage.handleLogs` | `/logs/:id` route | `navigate()` | ✓ WIRED | `navigate(\`/logs/${id}\`, ...)` |
| `LogPage` | `useLogStream` | `const { lines, connected } = useLogStream(containerId)` | ✓ WIRED | Called at top of `LogPage` component |
| `useLogStream` | `/api/containers/:id/logs` WS | `new WebSocket(wsUrl)` | ✓ WIRED | URL construction verified in hook |
| WS route | SSH + docker logs | `conn.exec(...)` | ✓ WIRED | Inside `conn.on('ready', ...)` callback |
| `stream.on('data')` | `socket.send()` | JSON serialization | ✓ WIRED | Each split line sent as `{ type:'log', line }` |
| `socket.on('close')` | `stream.destroy()` | direct call | ✓ WIRED | Server-side WS close handler |
| `useLogStream` cleanup | `wsRef.current.close()` | React effect cleanup | ✓ WIRED | Returned cleanup fn in `useEffect` |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No debt markers, stubs, or hollow implementations found |

No `TBD`, `FIXME`, `XXX`, `TODO`, or `HACK` markers found in any phase-modified file. No empty handler implementations. No hardcoded empty arrays passed to rendering paths.

---

### Human Verification Required

The following 4 items require a live browser and Docker host; they cannot be verified by static analysis:

#### 1. Real-Time Log Streaming

**Test:** Connect to a real Docker host, open a container's log view  
**Expected:** Last ~200 lines appear immediately; new lines appear within 1s  
**Why human:** Requires live SSH + Docker host; cannot test without running server

#### 2. ANSI Colour Rendering

**Test:** View logs from a container that emits ANSI colour codes (e.g. a Node.js app with chalk, or `echo -e "\033[32mGREEN\033[0m"`)  
**Expected:** Coloured text in the browser — no raw `\x1b[32m` escape sequences visible  
**Why human:** DOM-level colour rendering cannot be asserted with grep; `ansi-to-html` + `dangerouslySetInnerHTML` wiring is statically confirmed but visual output needs eyes

#### 3. Auto-Scroll Pause / Resume

**Test:** Open a high-volume log stream, scroll up  
**Expected:** Auto-scroll pauses; "↓ Resume" button appears floating at bottom; tapping it scrolls to bottom and re-enables auto-scroll  
**Why human:** Interactive scroll behaviour requires a browser session

#### 4. Stream Teardown on Close

**Test:** Open a log view, let it stream for ~5s, then navigate back  
**Expected:** `docker logs` process on the remote host terminates; SSH channel closes; no lingering file descriptors  
**Why human:** Requires inspecting server-side process table or SSH channel state at runtime

---

### Gaps Summary

**No gaps.** All 19 must-have truths are statically VERIFIED. Implementation is complete, wired, and free of debt markers or stubs.

The `human_needed` status reflects 4 runtime/visual behaviours that are correct by code inspection but must be confirmed in a live environment before the phase is considered fully accepted.

---

_Verified: 2025-01-30_  
_Verifier: gsd-verifier (automated static analysis)_
