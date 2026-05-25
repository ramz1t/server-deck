---
phase: 04-log-streaming
plan: 02
type: execute
wave: 2
depends_on:
  - 04-01
files_modified:
  - packages/web/package.json
  - packages/web/src/hooks/useLogStream.ts
  - packages/web/src/pages/LogPage.tsx
  - packages/web/src/components/ContainerCard.tsx
  - packages/web/src/App.tsx
autonomous: true
requirements:
  - LOGS-01
  - LOGS-02
  - LOGS-03
  - LOGS-04

must_haves:
  truths:
    - "User can tap 'Logs' on any ContainerCard and navigate to /logs/:containerId"
    - "LogPage shows the last ~200 lines immediately on open, then streams new lines in real time"
    - "ANSI colour codes render as coloured text — no raw escape sequences visible"
    - "Auto-scroll follows new lines; scrolling up pauses it; '↓ Resume' button re-enables it"
    - "Closing LogPage (navigating back) closes the WebSocket and triggers server-side stream.destroy()"
    - "Log lines cap at 5000 — oldest lines are dropped when exceeded"
    - "dangerouslySetInnerHTML is XSS-safe: Convert instantiated with escapeXML: true"
  artifacts:
    - path: "packages/web/src/hooks/useLogStream.ts"
      provides: "WS hook returning { lines, connected }"
      exports: ["useLogStream"]
    - path: "packages/web/src/pages/LogPage.tsx"
      provides: "Full-page log view component"
      exports: ["LogPage"]
    - path: "packages/web/src/components/ContainerCard.tsx"
      provides: "Logs button added to action area"
      contains: "onLogs"
    - path: "packages/web/src/App.tsx"
      provides: "Route /logs/:containerId wrapped in ProtectedRoute"
      contains: "logs/:containerId"
  key_links:
    - from: "packages/web/src/pages/LogPage.tsx"
      to: "packages/web/src/hooks/useLogStream.ts"
      via: "useLogStream(containerId) call"
      pattern: "useLogStream"
    - from: "packages/web/src/pages/LogPage.tsx"
      to: "ansi-to-html"
      via: "new Convert({ escapeXML: true })"
      pattern: "escapeXML.*true"
    - from: "packages/web/src/components/ContainerCard.tsx"
      to: "/logs/:containerId"
      via: "onLogs callback → useNavigate in DashboardPage"
      pattern: "onLogs"
    - from: "packages/web/src/App.tsx"
      to: "packages/web/src/pages/LogPage.tsx"
      via: "Route element={<LogPage />}"
      pattern: "LogPage"
---

<objective>
Deliver the full frontend log-streaming feature as a vertical slice: install ansi-to-html,
create the useLogStream hook, build LogPage with ANSI rendering and smart auto-scroll,
add a Logs button to ContainerCard, and wire the /logs/:containerId route in App.tsx.
After this plan, a user can tap "Logs" on any container and watch live output in the browser.

Purpose: Frontend half of the live log streaming feature. Depends on Plan 04-01 for the WS endpoint.
Output: useLogStream hook, LogPage component, ContainerCard Logs button, App.tsx route.
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
@packages/web/src/hooks/useContainerEvents.ts
@packages/web/src/components/ContainerCard.tsx
@packages/web/src/App.tsx
@packages/web/src/pages/DashboardPage.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install ansi-to-html + create useLogStream hook (Wave 1)</name>
  <files>packages/web/package.json, packages/web/src/hooks/useLogStream.ts</files>
  <action>
STEP 1 — Install ansi-to-html (per D-P4-10; package legitimacy [OK] per RESEARCH.md audit):
Run from the repo root: `pnpm add ansi-to-html --filter @serverdeck/web`
This adds `ansi-to-html` to `packages/web/package.json` dependencies. No `@types/ansi-to-html`
needed — the package ships its own TypeScript declarations at `./lib/ansi_to_html.d.ts`.

STEP 2 — Create `packages/web/src/hooks/useLogStream.ts`.
Model on `useContainerEvents.ts` — copy the overall shape (useEffect + useRef + cancelled flag +
exponential backoff reconnect). Key divergences:

IMPORTS (per PATTERNS.md hook imports block):
```
import { useEffect, useRef, useState } from 'react'
```
No `QueryClient` parameter — this hook manages its own state.

CONSTANTS (same as analog):
```
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000
```

SIGNATURE (per D-P4-14):
```
export function useLogStream(containerId: string): { lines: string[]; connected: boolean }
```

STATE:
- `const [lines, setLines] = useState<string[]>([])`
- `const [connected, setConnected] = useState(false)`
- `const retryDelayRef = useRef(BACKOFF_INITIAL_MS)`
- `const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)`
- `const wsRef = useRef<WebSocket | null>(null)`

useEffect DEPENDENCY ARRAY: `[containerId]` — re-connect if containerId changes.

WS URL (per D-P4-14 and PATTERNS.md WS URL derivation block):
```
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${protocol}//${window.location.host}/api/containers/${containerId}/logs`
```

ws.onopen: Set `connected(true)`, reset `retryDelayRef.current = BACKOFF_INITIAL_MS`.
If `cancelled`, close immediately.

ws.onmessage (per D-P4-07, D-P4-15): Parse JSON, check `msg.type === 'log'`, append `msg.line`:
```
setLines((prev) => {
  const next = [...prev, msg.line]
  // 5000-line cap — drop oldest (D-P4-15)
  return next.length > 5000 ? next.slice(next.length - 5000) : next
})
```
Wrap all of this in try/catch to silently ignore malformed messages.

ws.onclose: Set `connected(false)`. Exponential backoff reconnect (copy from PATTERNS.md
exponential backoff block) — only if not `cancelled`.

ws.onerror: Call `ws.close()` — onclose fires after onerror and handles reconnect.

CLEANUP (return value of useEffect): Set `cancelled = true`, clear reconnect timer,
close wsRef.current. This is what triggers `stream.destroy()` on the server side (LOGS-04).

Return `{ lines, connected }`.
  </action>
  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - `ansi-to-html` appears in `packages/web/package.json` dependencies
    - `packages/web/src/hooks/useLogStream.ts` exists and exports `useLogStream`
    - `useLogStream(containerId)` returns `{ lines: string[], connected: boolean }`
    - 5000-line cap with `slice(next.length - 5000)` present in onmessage handler
    - Cleanup function closes WS and cancels reconnect timer
    - `npx tsc --noEmit` passes with no errors on `packages/web`
  </done>
</task>

<task type="auto">
  <name>Task 2: Create LogPage.tsx with ANSI rendering and auto-scroll (Wave 2)</name>
  <files>packages/web/src/pages/LogPage.tsx</files>
  <action>
Create `packages/web/src/pages/LogPage.tsx`. This is the full-page log view (D-P4-03).

IMPORTS (per PATTERNS.md LogPage imports block):
```
import { useRef, useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useLogStream } from '../hooks/useLogStream'
import Convert from 'ansi-to-html'
```

ANSI CONVERTER — instantiate once outside the component function (module level) to avoid
re-creating on every render:
```
const converter = new Convert({ escapeXML: true, stream: true })
```
`escapeXML: true` is MANDATORY for XSS safety (D-P4-10, security requirement). Without it,
malicious container log output can inject arbitrary HTML via `dangerouslySetInnerHTML`.
`stream: true` enables stateful ANSI parsing across line boundaries.

COMPONENT SIGNATURE: `export function LogPage()`

ROUTING DATA (per D-P4-03, D-P4-02):
```
const { containerId } = useParams<{ containerId: string }>()
const navigate = useNavigate()
const location = useLocation()
const containerName =
  (location.state as { name?: string } | null)?.name ?? (containerId?.slice(0, 12) ?? 'unknown')
```

HOOK CALL (per D-P4-14):
```
const { lines, connected } = useLogStream(containerId ?? '')
```

AUTO-SCROLL STATE (per D-P4-12, D-P4-13 — from PATTERNS.md auto-scroll block):
```
const scrollRef = useRef<HTMLDivElement>(null)
const autoScrollRef = useRef(true)          // ref to avoid stale closure in effect
const [showResume, setShowResume] = useState(false)
```

AUTO-SCROLL EFFECT — runs when `lines` changes (per PATTERNS.md):
```
useEffect(() => {
  if (!autoScrollRef.current) return
  const el = scrollRef.current
  if (el) el.scrollTop = el.scrollHeight
}, [lines])
```

SCROLL EVENT HANDLER (per D-P4-12, threshold 50px):
```
function handleScroll() {
  const el = scrollRef.current
  if (!el) return
  const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 50
  autoScrollRef.current = atBottom
  setShowResume(!atBottom)
}
```

RESUME HANDLER (per D-P4-13):
```
function resumeAutoScroll() {
  autoScrollRef.current = true
  setShowResume(false)
  const el = scrollRef.current
  if (el) el.scrollTop = el.scrollHeight
}
```

ANSI LINE RENDER — use `useMemo` to avoid re-converting all lines on every render tick
(only recompute when `lines` array reference changes):
```
const htmlLines = useMemo(
  () =>
    lines.map((line) => {
      try {
        return converter.toHtml(line)
      } catch {
        // Binary or malformed line — fall back to raw text (escaped by React)
        return line
      }
    }),
  [lines],
)
```

JSX STRUCTURE (per D-P4-04, D-P4-11 and PATTERNS.md page skeleton):
Outer: `<div className="min-h-svh flex flex-col bg-black">`

HEADER (sticky, per D-P4-04 — from PATTERNS.md page skeleton):
- `sticky top-0 z-10 bg-black/80 backdrop-blur border-b border-zinc-800 px-4 py-3`
- Back button: `<Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Back to dashboard">`
  with `<ArrowLeft className="h-4 w-4" />` inside. Size `h-9 w-9 shrink-0` (44px tap target enforced by shadcn icon button)
- Container name: `<span className="font-semibold truncate flex-1">{containerName}</span>`
- Live/disconnected badge (per D-P4-04):
  - connected: `text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0` with text "live"
  - disconnected: `text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0` with text "disconnected"

MAIN SCROLL AREA:
- `<main className="flex-1 relative overflow-hidden">`
- Inner scroll div: `ref={scrollRef}` + `onScroll={handleScroll}` + `className="h-full overflow-y-auto"`
- Log container: `<pre className="font-mono text-sm text-zinc-200 whitespace-pre-wrap overflow-wrap-break-word bg-zinc-950 px-4 py-3 min-h-full">`
- Per-line render (per D-P4-11):
  ```tsx
  {htmlLines.map((html, i) => (
    <div
      key={i}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ))}
  ```
  NOTE: The fallback branch in `useMemo` returns raw `line` text — React will render it as a
  text node inside `dangerouslySetInnerHTML` escaped, which is safe since it's the `html` variable.
  Actually: if the try/catch returns `line` raw, it may still contain `<` characters. For the
  catch branch, wrap in `<span>` with textContent instead: return the plain text and render it as
  `dangerouslySetInnerHTML={{ __html: html }}` won't inject anything because the raw line is what
  Convert normally escapes anyway. Keep it simple — the catch path is only for truly unparseable
  binary data; return `''` (empty string) in the catch to skip the line rather than risk any injection.

FLOATING RESUME BUTTON (per D-P4-13 — inside `<main>`, positioned absolute):
From PATTERNS.md resume button block:
```tsx
{showResume && (
  <button
    type="button"
    onClick={resumeAutoScroll}
    className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-800 text-zinc-200 text-sm px-4 py-2 rounded-full shadow-lg border border-zinc-700 hover:bg-zinc-700 transition-colors min-h-[44px]"
  >
    ↓ Resume
  </button>
)}
```
  </action>
  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - `packages/web/src/pages/LogPage.tsx` exists and exports `LogPage`
    - `new Convert({ escapeXML: true, stream: true })` at module level (not inside component)
    - `useLogStream(containerId ?? '')` called; `lines` and `connected` destructured
    - Auto-scroll effect runs on `[lines]` dependency
    - `handleScroll` detects >50px from bottom and sets `showResume(true)`
    - `dangerouslySetInnerHTML={{ __html: html }}` used for ANSI-converted lines
    - Back button navigates to `/`; container name shown in header
    - `npx tsc --noEmit` passes with no errors
  </done>
</task>

<task type="auto">
  <name>Task 3: Add Logs button to ContainerCard + wire /logs/:containerId route in App.tsx (Wave 2)</name>
  <files>packages/web/src/components/ContainerCard.tsx, packages/web/src/App.tsx</files>
  <action>
TWO FILES — independent changes, no shared state between them.

--- FILE 1: packages/web/src/components/ContainerCard.tsx ---

Extend `ContainerCardProps` interface (per D-P4-01 and PATTERNS.md prop interface extension):
Add `onLogs: (id: string) => void` to the interface after `isActing: boolean`.

Add `onLogs` to the destructured props in the function signature.

Add the Logs button inside `<div className="flex justify-end gap-2">` BEFORE the existing
state-conditional buttons (per D-P4-01 "present for all containers regardless of state").
Use the exact markup from PATTERNS.md Logs button block:
```tsx
{/* Logs — always visible regardless of container state (D-P4-01) */}
<Button
  variant="ghost"
  size="sm"
  className="min-h-[44px] h-11"
  onClick={() => onLogs(container.id)}
>
  Logs
</Button>
```
`variant="ghost"` per D-P4-01 (not "outline" — existing Restart/Stop/Start use "outline").
`min-h-[44px] h-11` for 44px touch target (MOBL-03 pattern from existing buttons).

No other changes to ContainerCard.tsx.

--- FILE 2: packages/web/src/App.tsx ---

ADD IMPORT (after existing `DashboardPage` import, per PATTERNS.md App.tsx import block):
```
import { LogPage } from './pages/LogPage'
```

EXTEND PROTECTED ROUTE (per D-P4-03 and PATTERNS.md route pattern — nest inside existing
`<Route path="/" element={<ProtectedRoute />}>` block):
```tsx
<Route path="/" element={<ProtectedRoute />}>
  <Route index element={<DashboardPage />} />
  <Route path="logs/:containerId" element={<LogPage />} />
</Route>
```
Note path is `logs/:containerId` (relative, no leading `/`) — React Router v6 convention for
nested routes. `containerId` matches `useParams<{ containerId: string }>()` in LogPage.

--- WIRING THE LOGS NAVIGATION ---
The `onLogs` callback on ContainerCard must eventually call `useNavigate`. This wiring
happens in `DashboardPage.tsx` — the existing component that renders `<ContainerCard>`.

Open `packages/web/src/pages/DashboardPage.tsx` and make these two targeted changes:

1. ADD `useNavigate` to the existing react-router-dom import:
   Change: `import { useNavigate, useOutletContext } from 'react-router-dom'`
   (it already imports `useOutletContext` and `useNavigate` — check first; if `useNavigate`
   is already imported, skip this step)

2. ADD navigate call inside the component body (after existing `const navigate = useNavigate()`
   or add it if absent):
   ```
   const navigate = useNavigate()
   ```

3. ADD `onLogs` handler in DashboardPage body:
   ```
   function handleLogs(id: string) {
     const container = containers?.find((c) => c.id === id)
     navigate(`/logs/${id}`, {
       state: { name: container?.names[0] ?? id.slice(0, 12) },
     })
   }
   ```
   This passes the container name via router state (per D-P4-02) — no extra API call on LogPage.

4. PASS `onLogs={handleLogs}` to each `<ContainerCard>` render call in DashboardPage.
   Find every `<ContainerCard` element (inside grouped and standalone renders) and add
   `onLogs={handleLogs}` prop.
  </action>
  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - `ContainerCardProps` has `onLogs: (id: string) => void`
    - Logs `<Button variant="ghost">` appears before state-conditional buttons in ContainerCard
    - `App.tsx` imports `LogPage` and has `<Route path="logs/:containerId" element={<LogPage />}>`
    - `DashboardPage.tsx` has `handleLogs` that calls `navigate('/logs/${id}', { state: { name } })`
    - `<ContainerCard onLogs={handleLogs} ...>` in DashboardPage (all call sites)
    - `npx tsc --noEmit` passes with no errors on `packages/web`
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WS → browser DOM | Log lines from server are passed through ansi-to-html and injected via dangerouslySetInnerHTML |
| URL state | `location.state.name` comes from in-app navigation (router state); not from URL bar — low risk |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-07 | Tampering / XSS | `dangerouslySetInnerHTML` in LogPage | mitigate | `new Convert({ escapeXML: true })` — HTML-encodes `<`, `>`, `&` before ANSI conversion; without this, malicious container log output injects arbitrary HTML |
| T-04-08 | Tampering | ansi-to-html binary/unparseable data | mitigate | try/catch around `converter.toHtml(line)` returns `''` on error — bad lines are silently dropped, no crash, no injection |
| T-04-09 | Information Disclosure | WS URL exposes container ID in path | accept | Auth-gated route; container ID is not a secret; authenticated user can already list containers |
| T-04-10 | Denial of Service | Runaway log lines fill browser memory | mitigate | 5000-line cap with `slice(next.length - 5000)` — oldest lines dropped on overflow (D-P4-15) |
| T-04-11 | Spoofing | ProtectedRoute bypass | accept | ProtectedRoute redirects unauthenticated users to /login; server-side preHandler provides second layer |
| T-04-SC | Tampering | npm package install (ansi-to-html) | mitigate | Package legitimacy [OK] per RESEARCH.md audit (14 yr old package, 2.3M/week downloads, no postinstall script) |
</threat_model>

<verification>
After all tasks complete:

```bash
# TypeScript clean compile
cd packages/web && npx tsc --noEmit

# ansi-to-html in package.json
grep "ansi-to-html" packages/web/package.json

# escapeXML: true present (XSS safety gate)
grep -v '^//' packages/web/src/pages/LogPage.tsx | grep "escapeXML.*true"

# 5000-line cap present
grep "5000" packages/web/src/hooks/useLogStream.ts

# onLogs prop in ContainerCard
grep "onLogs" packages/web/src/components/ContainerCard.tsx

# Route wired in App.tsx
grep "logs/:containerId" packages/web/src/App.tsx

# navigate call in DashboardPage passes router state with name
grep "state.*name" packages/web/src/pages/DashboardPage.tsx
```
</verification>

<success_criteria>
- `pnpm add ansi-to-html --filter @serverdeck/web` succeeds; package in package.json
- `useLogStream(containerId)` returns `{ lines, connected }`; WS connects to `/api/containers/${containerId}/logs`
- `lines` capped at 5000; `setLines` uses functional update with `slice(next.length - 5000)`
- `LogPage` renders with sticky back-button header, container name, live/disconnected badge
- `new Convert({ escapeXML: true, stream: true })` instantiated at module level
- Each line rendered via `dangerouslySetInnerHTML={{ __html: htmlLines[i] }}` after ANSI conversion
- Auto-scroll follows new lines; pauses when user scrolls >50px above bottom
- "↓ Resume" floating button re-enables auto-scroll and jumps to bottom
- ContainerCard `<Button variant="ghost">Logs</Button>` present before state-conditional buttons
- `onLogs(container.id)` callback wired; DashboardPage calls `navigate('/logs/${id}', { state: { name } })`
- `/logs/:containerId` nested inside existing `<Route path="/" element={<ProtectedRoute />}>` in App.tsx
- `npx tsc --noEmit` passes with zero errors on `packages/web`
</success_criteria>

<output>
Create `.planning/phases/04-log-streaming/04-02-SUMMARY.md` when done
</output>
