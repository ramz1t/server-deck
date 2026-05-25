---
phase: 03-real-time-container-status
plan: 02
type: execute
wave: 2
depends_on:
  - 03-PLAN-backend-ws
files_modified:
  - packages/web/src/hooks/useContainerEvents.ts
  - packages/web/src/pages/DashboardPage.tsx
autonomous: true
requirements:
  - CONT-03
must_haves:
  truths:
    - "DashboardPage opens a WebSocket to /api/containers/events on mount"
    - "Each WS message updates the TanStack Query cache via queryClient.setQueryData(['containers'], data)"
    - "refetchInterval is false while WS is connected; re-enables at 5000ms when WS disconnects"
    - "WS disconnect triggers reconnect with exponential backoff (1s→2s→4s→…→30s max)"
    - "A 'reconnecting…' indicator is visible in the header when WS is disconnected (and not the first load)"
    - "WS connection is cleaned up on component unmount (WebSocket.close() called)"
  artifacts:
    - path: "packages/web/src/hooks/useContainerEvents.ts"
      provides: "useContainerEvents(queryClient) hook — WS lifecycle, backoff reconnect, cache injection"
      exports: ["useContainerEvents"]
    - path: "packages/web/src/pages/DashboardPage.tsx"
      provides: "Dashboard integrating useContainerEvents hook with dynamic refetchInterval and reconnect indicator"
      contains: "useContainerEvents"
  key_links:
    - from: "packages/web/src/pages/DashboardPage.tsx"
      to: "packages/web/src/hooks/useContainerEvents.ts"
      via: "const { wsConnected } = useContainerEvents(queryClient)"
      pattern: "useContainerEvents"
    - from: "packages/web/src/hooks/useContainerEvents.ts"
      to: "/api/containers/events"
      via: "new WebSocket(wsUrl) — native browser WebSocket API"
      pattern: "new WebSocket"
    - from: "packages/web/src/hooks/useContainerEvents.ts"
      to: "queryClient"
      via: "queryClient.setQueryData(['containers'], data) on each message"
      pattern: "setQueryData"
---

<objective>
Create the useContainerEvents hook and integrate it into DashboardPage, replacing static polling with WebSocket-driven cache updates, exponential-backoff reconnect, and a "reconnecting…" status indicator.

Purpose: Delivers the browser-side half of the live-push pipeline (D-P3-12 through D-P3-15). After this plan, container state changes on the CLI reflect in the browser within 2 seconds.
Output: DashboardPage driven by live WS push; polling only as fallback when WS is down; "reconnecting…" indicator in header during disconnects.
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-real-time-container-status/03-CONTEXT.md
@.planning/phases/03-real-time-container-status/03-RESEARCH.md
@.planning/phases/03-real-time-container-status/03-PATTERNS.md
@.planning/phases/03-real-time-container-status/03-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create useContainerEvents hook</name>
  <files>
    packages/web/src/hooks/useContainerEvents.ts
  </files>

  <read_first>
    - packages/web/src/pages/DashboardPage.tsx — lines 1–30: existing imports and ContainerInfo interface definition to reuse in the hook's message type
    - .planning/phases/03-real-time-container-status/03-RESEARCH.md §Pattern 6 (setQueryData v5 API), §Architecture Diagram (WS message flow and wsConnected state)
    - .planning/phases/03-real-time-container-status/03-CONTEXT.md §D-P3-12 through D-P3-15
  </read_first>

  <action>
    Create packages/web/src/hooks/useContainerEvents.ts.
    The hooks directory does not exist yet — create it along with the file.

    Imports:
      import { useEffect, useRef, useState } from 'react'
      import type { QueryClient } from '@tanstack/react-query'

    ContainerInfo interface (copy from DashboardPage.tsx — same shape, local to hook):
      interface ContainerInfo {
        id: string; shortId: string; names: string[]
        image: string; status: string; state: string; createdAt: string
      }

    WsMessage interface:
      interface WsMessage { type: 'containers'; data: ContainerInfo[] }

    Constants:
      const BACKOFF_INITIAL_MS = 1_000
      const BACKOFF_MAX_MS = 30_000

    Export function useContainerEvents(queryClient: QueryClient): { wsConnected: boolean }

    Inside the hook:
      const [wsConnected, setWsConnected] = useState(false)
      const retryDelayRef = useRef(BACKOFF_INITIAL_MS)
      const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
      const wsRef = useRef<WebSocket | null>(null)

      useEffect(() => {
        let cancelled = false

        function connect() {
          if (cancelled) return
          // Derive WS URL from current page origin — handles both dev proxy and prod
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
          const wsUrl = `${protocol}//${window.location.host}/api/containers/events`
          const ws = new WebSocket(wsUrl)
          wsRef.current = ws

          ws.onopen = () => {
            if (cancelled) { ws.close(); return }
            setWsConnected(true)
            retryDelayRef.current = BACKOFF_INITIAL_MS  // reset backoff on successful connect
          }

          ws.onmessage = (event) => {
            if (cancelled) return
            try {
              const msg = JSON.parse(event.data as string) as WsMessage
              if (msg.type === 'containers') {
                queryClient.setQueryData(['containers'], msg.data)
              }
            } catch { /* malformed message — ignore */ }
          }

          ws.onclose = () => {
            if (cancelled) return
            setWsConnected(false)
            // Exponential backoff reconnect (D-P3-14)
            const delay = retryDelayRef.current
            retryDelayRef.current = Math.min(delay * 2, BACKOFF_MAX_MS)
            reconnectTimerRef.current = setTimeout(connect, delay)
          }

          ws.onerror = () => {
            // onclose fires after onerror — reconnect is handled in onclose
            ws.close()
          }
        }

        connect()

        // Cleanup: cancel reconnects and close the socket on unmount
        return () => {
          cancelled = true
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
          if (wsRef.current) wsRef.current.close()
          setWsConnected(false)
        }
      }, [queryClient])   // queryClient is stable — effect runs once on mount

      return { wsConnected }

    NOTE on WS URL construction: using `window.location.host` (includes port) + `/api/containers/events`
    ensures the cookie is sent automatically (same-origin). The Vite dev proxy forwards WS connections
    to the backend — no CORS or explicit credential passing needed. Do NOT hardcode localhost:3001.

    NOTE on wsConnected initial state: `false` is correct — the indicator should NOT show on first page
    load (before WS has had a chance to connect). The indicator only appears after the WS has connected
    at least once and then disconnected. To implement this, add a `hasConnectedOnce` ref:
      const hasConnectedOnce = useRef(false)
    Set it to true in ws.onopen. Return { wsConnected, hasConnectedOnce: hasConnectedOnce.current }
    so DashboardPage can conditionally render the indicator only when `!wsConnected && hasConnectedOnce.current`.
  </action>

  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>

  <acceptance_criteria>
    - `packages/web/src/hooks/useContainerEvents.ts` exists and exports `useContainerEvents`
    - Hook accepts `queryClient: QueryClient` parameter and returns `{ wsConnected: boolean, hasConnectedOnce: boolean }`
    - Hook uses native `WebSocket` (no external WS library import)
    - `queryClient.setQueryData(['containers'], msg.data)` is called on each message where `msg.type === 'containers'`
    - `setWsConnected(true)` is set in `ws.onopen` and `setWsConnected(false)` in `ws.onclose`
    - Reconnect uses exponential backoff: `retryDelayRef.current = Math.min(delay * 2, BACKOFF_MAX_MS)` in `ws.onclose`
    - Cleanup function calls `ws.close()` and `clearTimeout` on unmount
    - `npx tsc --noEmit` in packages/web exits with code 0
  </acceptance_criteria>

  <done>useContainerEvents hook compiles cleanly and implements: same-origin WS URL construction, setQueryData on message, wsConnected state, hasConnectedOnce ref, exponential backoff reconnect, and cleanup on unmount.</done>
</task>

<task type="auto">
  <name>Task 2: Integrate hook into DashboardPage — dynamic refetchInterval and reconnect indicator</name>
  <files>
    packages/web/src/pages/DashboardPage.tsx
  </files>

  <read_first>
    - packages/web/src/pages/DashboardPage.tsx — full file: existing useQuery call (line 88–98 with refetchInterval: 5000), header JSX structure (lines 156–180), all imports
    - packages/web/src/hooks/useContainerEvents.ts — the hook created in Task 1 (return shape: { wsConnected, hasConnectedOnce })
    - .planning/phases/03-real-time-container-status/03-CONTEXT.md §D-P3-12, D-P3-13, D-P3-14, D-P3-15
  </read_first>

  <action>
    Three targeted changes to DashboardPage.tsx — do not restructure the file:

    CHANGE 1 — Add import for the new hook (after the existing import block):
      import { useContainerEvents } from '../hooks/useContainerEvents'

    CHANGE 2 — After `const queryClient = useQueryClient()` (line 85), add:
      const { wsConnected, hasConnectedOnce } = useContainerEvents(queryClient)

    CHANGE 3 — Change the useQuery call's refetchInterval from the static `5000` to a dynamic value:
      Replace:
        refetchInterval: 5000,
      With:
        refetchInterval: wsConnected ? false : 5000,

    CHANGE 4 — Add reconnecting indicator to the header. In the header's inner flex div (lines 157–179),
    add a status pill between the server identity block and the action buttons. The pill should only render
    when `!wsConnected && hasConnectedOnce`:

      {!wsConnected && hasConnectedOnce && (
        <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0">
          reconnecting…
        </span>
      )}

    Insert this span as a sibling inside the existing header flex container, between the left identity
    block (Server icon + ServerDeck label + username@host) and the right button group (RefreshCw + Log out).
    This span has `shrink-0` so it does not compress neighbouring elements.

    No other changes to DashboardPage.tsx. The existing mutation, groupContainersByProject, ContainerCard
    rendering, loading/error/empty states, and logout handler are all unchanged.
  </action>

  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>

  <acceptance_criteria>
    - `import { useContainerEvents } from '../hooks/useContainerEvents'` is present in DashboardPage.tsx
    - `useContainerEvents(queryClient)` is called inside DashboardPage component function
    - `refetchInterval: wsConnected ? false : 5000` replaces `refetchInterval: 5000` in the useQuery call
    - Header JSX contains a conditional span that renders only when `!wsConnected && hasConnectedOnce`
    - The span contains the text "reconnecting…" (with ellipsis) and uses yellow colour classes
    - `npx tsc --noEmit` in packages/web exits with code 0
    - No other logic in DashboardPage was removed or restructured (mutations, grouping, rendering all intact)
  </acceptance_criteria>

  <done>DashboardPage uses useContainerEvents hook, disables polling while WS is connected, re-enables 5s polling on WS disconnect, and shows a yellow "reconnecting…" pill in the header when the WS has disconnected after its first successful connection.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser WebSocket → Fastify | WS messages received from server are trusted (server-signed data); messages are parsed with try/catch to guard against malformed JSON |
| Browser → Cookie | sd_token httpOnly cookie is sent automatically on WS upgrade (same-origin); no token exposure in JS |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-F01 | Tampering | WS message parsing in useContainerEvents | mitigate | `JSON.parse` wrapped in try/catch; message validated to have `type === 'containers'` before calling setQueryData — malformed or unexpected messages are silently dropped |
| T-03-F02 | Denial of Service | WebSocket reconnect loop | accept | Exponential backoff (1s→30s) prevents tight reconnect loops on persistent server outage — acceptable for a personal LAN tool with no external exposure |
| T-03-F03 | Information Disclosure | sd_token cookie on WS upgrade | accept | Cookie is httpOnly (set in Phase 1 per D-06); never accessible in JS; sent automatically on same-origin WS upgrade — no additional exposure vs HTTP requests |
| T-03-F04 | Spoofing | WS URL origin | accept | WS URL derived from `window.location.host` (same-origin) — no user-controlled input; immune to open-redirect manipulation |
</threat_model>

<verification>
Full end-to-end verification after both plans execute:

1. Frontend compiles: `cd packages/web && npx tsc --noEmit` exits 0
2. Backend compiles: `cd packages/server && npx tsc --noEmit` exits 0
3. Start server and frontend dev server; open browser at http://localhost:5173
4. Verify no "reconnecting…" pill on initial load (WS should connect successfully)
5. In a separate terminal, run `docker stop <any-container>` — badge should flip to stopped within 2 seconds without any page interaction
6. Run `docker start <same-container>` — badge should flip to running within 2 seconds
7. Kill the backend server — "reconnecting…" pill appears in header; polling resumes (network tab shows GET /api/containers every 5s); restart backend — pill disappears
8. Open two browser tabs — verify badge updates propagate to both tabs simultaneously (one global stream, two WS clients)
9. Verify one SSH events stream: check server logs for "docker events" — should show only one stream open regardless of how many browser tabs are connected
</verification>

<success_criteria>
- useContainerEvents hook compiles and manages WS lifecycle correctly
- DashboardPage refetchInterval is dynamically toggled based on wsConnected state
- "reconnecting…" indicator appears only after the WS has connected once and then disconnected
- Container badge updates arrive in browser within 2 seconds of CLI docker start/stop
- No per-client SSH streams — one global stream verified in server logs
- Full TypeScript compilation passes in both packages
</success_criteria>

<output>
Create `.planning/phases/03-real-time-container-status/03-02-SUMMARY.md` when done
</output>
